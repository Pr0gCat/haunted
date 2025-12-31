import { spawn, type ChildProcess } from "node:child_process";
import { createLogger } from "@/utils/logger.ts";
import { InteractiveSession, sessionManager } from "@/agents/interactive-session.ts";

const logger = createLogger("base-agent");

export interface AgentResult {
  success: boolean;
  output: string;
  error?: string;
  exitCode: number;
}

export interface AgentContext {
  repo: string;
  issueNumber: number;
  workDir: string;
  systemPrompt: string;
  task: string;
}

export abstract class BaseAgent {
  protected name: string;
  protected currentProcess: ChildProcess | null = null;
  protected currentSession: InteractiveSession | null = null;
  protected isRunning: boolean = false;

  constructor(name: string) {
    this.name = name;
  }

  abstract execute(context: AgentContext): Promise<AgentResult>;

  async cancel(): Promise<void> {
    // Cancel interactive session if active
    if (this.currentSession && this.currentSession.isSessionActive()) {
      logger.info({ agent: this.name }, "Cancelling interactive session");
      await this.currentSession.stop();
      this.currentSession = null;
    }

    // Cancel traditional process if active
    if (this.currentProcess && this.isRunning) {
      logger.info({ agent: this.name }, "Cancelling agent execution");
      this.currentProcess.kill("SIGTERM");

      await new Promise<void>((resolve) => {
        setTimeout(() => {
          if (this.currentProcess && this.isRunning) {
            this.currentProcess.kill("SIGKILL");
          }
          resolve();
        }, 5000);
      });

      this.isRunning = false;
      this.currentProcess = null;
    }
  }

  /**
   * Run Claude Code using interactive streaming session (faster)
   * This reuses sessions for better performance
   */
  protected async runClaudeCodeInteractive(
    workDir: string,
    prompt: string,
    options: {
      systemPrompt?: string;
      timeout?: number;
      reuseSession?: boolean;
      allowEdits?: boolean;
    } = {}
  ): Promise<AgentResult> {
    const { systemPrompt, timeout = 600000, reuseSession = true, allowEdits = false } = options;

    logger.info({ agent: this.name, workDir, reuseSession, allowEdits }, "Running Claude Code (interactive mode)");

    try {
      let session: InteractiveSession;

      if (reuseSession) {
        session = await sessionManager.getSession(workDir, systemPrompt, allowEdits);
      } else {
        session = new InteractiveSession({ workDir, systemPrompt, allowEdits });
        await session.start();
      }

      this.currentSession = session;
      this.isRunning = true;

      const output = await session.sendAndWait(prompt, timeout);

      this.isRunning = false;

      // Don't stop session if reusing
      if (!reuseSession) {
        await session.stop();
        this.currentSession = null;
      }

      return {
        success: true,
        output: output.trim(),
        exitCode: 0,
      };
    } catch (error) {
      this.isRunning = false;
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ agent: this.name, error: errorMessage }, "Interactive session error");

      return {
        success: false,
        output: "",
        error: errorMessage,
        exitCode: 1,
      };
    }
  }

  /**
   * Run Claude Code using traditional --print mode
   * Use this for one-off commands where session reuse isn't beneficial
   */
  protected async runClaudeCode(
    workDir: string,
    prompt: string,
    options: {
      print?: boolean;
      allowEdits?: boolean;
      systemPrompt?: string;
      timeout?: number;
    } = {}
  ): Promise<AgentResult> {
    const { print = false, allowEdits = false, systemPrompt, timeout = 600000 } = options;

    const args: string[] = [];

    if (print) {
      args.push("--print");
    }

    if (allowEdits) {
      args.push("--dangerously-skip-permissions");
    }

    if (systemPrompt) {
      args.push("--system-prompt", systemPrompt);
    }

    args.push(prompt);

    logger.info({ agent: this.name, workDir, print, allowEdits }, "Running Claude Code");

    return new Promise((resolve) => {
      this.isRunning = true;

      this.currentProcess = spawn("claude", args, {
        cwd: workDir,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
      });

      let stdout = "";
      let stderr = "";

      const timeoutId = setTimeout(() => {
        logger.warn({ agent: this.name }, "Agent execution timed out");
        this.cancel();
      }, timeout);

      this.currentProcess.stdout?.on("data", (data) => {
        stdout += data.toString();
      });

      this.currentProcess.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      this.currentProcess.on("error", (error) => {
        clearTimeout(timeoutId);
        this.isRunning = false;
        logger.error({ agent: this.name, error }, "Agent process error");
        resolve({
          success: false,
          output: stdout,
          error: error.message,
          exitCode: 1,
        });
      });

      this.currentProcess.on("close", (code) => {
        clearTimeout(timeoutId);
        this.isRunning = false;
        this.currentProcess = null;

        const exitCode = code ?? 0;
        const success = exitCode === 0;

        if (success) {
          logger.info({ agent: this.name, exitCode }, "Agent completed successfully");
        } else {
          logger.warn({ agent: this.name, exitCode, stderr }, "Agent completed with errors");
        }

        resolve({
          success,
          output: stdout.trim(),
          error: stderr.trim() || undefined,
          exitCode,
        });
      });
    });
  }

  isActive(): boolean {
    return this.isRunning;
  }

  getName(): string {
    return this.name;
  }
}

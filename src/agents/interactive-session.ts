import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { createLogger } from "@/utils/logger.ts";

const logger = createLogger("interactive-session");

/**
 * Claude Code CLI streaming JSON message types
 */
export interface StreamMessage {
  type: "assistant" | "user" | "system" | "result";
  subtype?: string;
  session_id?: string;
  is_error?: boolean;
  result?: string;
  total_cost_usd?: number;
  message?: {
    role: string;
    content: MessageContent[];
  };
}

export interface MessageContent {
  type: "text" | "tool_use" | "tool_result";
  text?: string;
  name?: string;
  input?: unknown;
}

export interface UserMessage {
  type: "user";
  message: {
    role: "user";
    content: string;
  };
}

export interface SessionEvents {
  message: [StreamMessage];
  text: [string];
  toolUse: [{ name: string; input: unknown }];
  result: [{ success: boolean; output: string; cost?: number }];
  error: [Error];
  close: [number];
}

/**
 * Interactive Claude Code session using streaming JSON mode
 * This allows for persistent sessions without using the Agent SDK
 */
export class InteractiveSession extends EventEmitter<SessionEvents> {
  private process: ChildProcess | null = null;
  private sessionId: string;
  private workDir: string;
  private systemPrompt?: string;
  private buffer: string = "";
  private isActive: boolean = false;
  private outputBuffer: string = "";

  private allowEdits: boolean;

  constructor(options: {
    workDir: string;
    systemPrompt?: string;
    sessionId?: string;
    allowEdits?: boolean;
  }) {
    super();
    this.workDir = options.workDir;
    this.systemPrompt = options.systemPrompt;
    this.sessionId = options.sessionId || randomUUID();
    this.allowEdits = options.allowEdits ?? false;
  }

  /**
   * Start the interactive session
   */
  async start(): Promise<void> {
    if (this.isActive) {
      throw new Error("Session already active");
    }

    const args: string[] = [
      "--print",
      "--verbose",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--session-id",
      this.sessionId,
    ];

    if (this.allowEdits) {
      args.push("--dangerously-skip-permissions");
    }

    if (this.systemPrompt) {
      args.push("--system-prompt", this.systemPrompt);
    }

    logger.info({ sessionId: this.sessionId, workDir: this.workDir }, "Starting interactive session");

    this.process = spawn("claude", args, {
      cwd: this.workDir,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    this.isActive = true;

    // Handle stdout (streaming JSON responses)
    this.process.stdout?.on("data", (data: Buffer) => {
      this.handleOutput(data.toString());
    });

    // Handle stderr
    this.process.stderr?.on("data", (data: Buffer) => {
      const text = data.toString();
      logger.debug({ sessionId: this.sessionId, stderr: text }, "Stderr output");
    });

    this.process.on("error", (error) => {
      logger.error({ sessionId: this.sessionId, error }, "Process error");
      this.isActive = false;
      this.emit("error", error);
    });

    this.process.on("close", (code) => {
      logger.info({ sessionId: this.sessionId, code }, "Session closed");
      this.isActive = false;
      this.emit("close", code ?? 0);
    });

    // Wait a moment for the process to start
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  /**
   * Send a message to the session
   */
  async send(text: string): Promise<void> {
    if (!this.isActive || !this.process?.stdin) {
      throw new Error("Session not active");
    }

    this.outputBuffer = "";

    const message: UserMessage = {
      type: "user",
      message: {
        role: "user",
        content: text,
      },
    };

    const jsonLine = JSON.stringify(message) + "\n";
    logger.debug({ sessionId: this.sessionId, message: text.slice(0, 100) }, "Sending message");

    return new Promise((resolve, reject) => {
      this.process!.stdin!.write(jsonLine, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Send a message and wait for the complete response
   */
  async sendAndWait(text: string, timeout: number = 600000): Promise<string> {
    await this.send(text);

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Response timeout after ${timeout}ms`));
      }, timeout);

      const handleResult = ({ success, output }: { success: boolean; output: string }) => {
        clearTimeout(timeoutId);
        this.off("result", handleResult);
        this.off("error", handleError);

        if (success) {
          resolve(output);
        } else {
          reject(new Error(output || "Unknown error"));
        }
      };

      const handleError = (error: Error) => {
        clearTimeout(timeoutId);
        this.off("result", handleResult);
        this.off("error", handleError);
        reject(error);
      };

      this.on("result", handleResult);
      this.on("error", handleError);
    });
  }

  /**
   * Handle streaming output from Claude Code
   */
  private handleOutput(data: string): void {
    this.buffer += data;

    // Process complete JSON lines
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || ""; // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const message = JSON.parse(line) as StreamMessage;
        this.processMessage(message);
      } catch (error) {
        logger.debug({ line, error }, "Failed to parse JSON line");
      }
    }
  }

  /**
   * Process a streaming message
   */
  private processMessage(message: StreamMessage): void {
    this.emit("message", message);

    switch (message.type) {
      case "assistant":
        if (message.message?.content) {
          for (const content of message.message.content) {
            if (content.type === "text" && content.text) {
              this.outputBuffer += content.text;
              this.emit("text", content.text);
            } else if (content.type === "tool_use" && content.name) {
              this.emit("toolUse", { name: content.name, input: content.input });
            }
          }
        }
        break;

      case "result":
        this.emit("result", {
          success: !message.is_error,
          output: message.result || this.outputBuffer,
          cost: message.total_cost_usd,
        });
        break;

      case "system":
        logger.debug({ subtype: message.subtype }, "System message");
        break;
    }
  }

  /**
   * Stop the session
   */
  async stop(): Promise<void> {
    if (!this.isActive || !this.process) {
      return;
    }

    logger.info({ sessionId: this.sessionId }, "Stopping session");

    // Close stdin to signal end of input
    this.process.stdin?.end();

    // Wait for graceful shutdown
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (this.process) {
          this.process.kill("SIGKILL");
        }
        resolve();
      }, 5000);

      this.process?.on("close", () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    this.isActive = false;
    this.process = null;
  }

  /**
   * Check if session is active
   */
  isSessionActive(): boolean {
    return this.isActive;
  }

  /**
   * Get session ID
   */
  getSessionId(): string {
    return this.sessionId;
  }
}

/**
 * Session manager for reusing sessions
 */
export class SessionManager {
  private sessions: Map<string, InteractiveSession> = new Map();

  /**
   * Get or create a session for a specific work directory
   */
  async getSession(
    workDir: string,
    systemPrompt?: string,
    allowEdits?: boolean
  ): Promise<InteractiveSession> {
    const key = `${workDir}:${systemPrompt || "default"}:${allowEdits ? "edit" : "readonly"}`;

    let session = this.sessions.get(key);

    if (session && session.isSessionActive()) {
      return session;
    }

    // Create new session
    session = new InteractiveSession({ workDir, systemPrompt, allowEdits });
    await session.start();

    this.sessions.set(key, session);

    // Clean up when session closes
    session.on("close", () => {
      this.sessions.delete(key);
    });

    return session;
  }

  /**
   * Close all sessions
   */
  async closeAll(): Promise<void> {
    const closePromises = Array.from(this.sessions.values()).map((session) => session.stop());
    await Promise.all(closePromises);
    this.sessions.clear();
  }
}

// Global session manager
export const sessionManager = new SessionManager();

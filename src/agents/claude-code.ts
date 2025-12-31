import { BaseAgent, type AgentResult, type AgentContext } from "@/agents/base-agent.ts";
import { WorktreeManager, type Worktree } from "@/agents/worktree.ts";
import { createLogger } from "@/utils/logger.ts";
import type { Config } from "@/config/schema.ts";
import type { Issue } from "@/github/issues.ts";
import type { PullRequest } from "@/github/pull-requests.ts";

const logger = createLogger("claude-code");

export interface TaskResult {
  success: boolean;
  branchName: string;
  filesChanged: string[];
  summary: string;
  error?: string;
  directCommit?: boolean; // true if changes were committed directly to main
}

interface ActiveTask {
  issueNumber: number;
  repo: string;
  worktree: Worktree;
  agent: ClaudeCodeWorker;
  startedAt: Date;
}

class ClaudeCodeWorker extends BaseAgent {
  constructor(id: number) {
    super(`ClaudeCode-${id}`);
  }

  async execute(context: AgentContext): Promise<AgentResult> {
    // Use interactive mode for faster execution with session reuse
    return this.runClaudeCodeInteractive(context.workDir, context.task, {
      systemPrompt: context.systemPrompt,
      timeout: 1200000, // 20 minutes for complex tasks
      reuseSession: false, // Each task gets its own session for isolation
      allowEdits: true, // Allow file modifications without permission prompts
    });
  }
}

export class ClaudeCodeAgentPool {
  private config: Config;
  private worktreeManager: WorktreeManager;
  private maxWorkers: number;
  private workers: ClaudeCodeWorker[] = [];
  private activeTasks: Map<string, ActiveTask> = new Map();
  private repoPath: string;

  constructor(
    config: Config,
    repoPath: string,
    options: { maxWorkers?: number; worktreeBaseDir?: string } = {}
  ) {
    this.config = config;
    this.repoPath = repoPath;
    this.maxWorkers = options.maxWorkers ?? 3;
    this.worktreeManager = new WorktreeManager(options.worktreeBaseDir);

    for (let i = 0; i < this.maxWorkers; i++) {
      this.workers.push(new ClaudeCodeWorker(i));
    }
  }

  async init(): Promise<void> {
    await this.worktreeManager.init();
    logger.info({ maxWorkers: this.maxWorkers }, "Claude Code agent pool initialized");
  }

  async executeTask(issue: Issue, repo: string): Promise<TaskResult> {
    const taskKey = `${repo}:${issue.number}`;

    if (this.activeTasks.has(taskKey)) {
      logger.warn({ repo, issueNumber: issue.number }, "Task already in progress");
      return {
        success: false,
        branchName: "",
        filesChanged: [],
        summary: "Task already in progress",
        error: "Duplicate task",
      };
    }

    const worker = this.getAvailableWorker();
    if (!worker) {
      logger.warn("No available workers");
      return {
        success: false,
        branchName: "",
        filesChanged: [],
        summary: "No available workers",
        error: "All workers are busy",
      };
    }

    const branchName = `${this.config.agents.claude_code.branch_prefix}issue-${issue.number}`;

    const worktree = await this.worktreeManager.createWorktree(
      repo,
      this.repoPath,
      issue.number,
      branchName
    );

    const task: ActiveTask = {
      issueNumber: issue.number,
      repo,
      worktree,
      agent: worker,
      startedAt: new Date(),
    };

    this.activeTasks.set(taskKey, task);

    try {
      const result = await this.runTask(task, issue);
      return result;
    } finally {
      this.activeTasks.delete(taskKey);
    }
  }

  private async runTask(task: ActiveTask, issue: Issue): Promise<TaskResult> {
    const systemPrompt = this.getSystemPrompt(issue);
    const taskPrompt = this.getTaskPrompt(issue);

    const context: AgentContext = {
      repo: task.repo,
      issueNumber: issue.number,
      workDir: task.worktree.path,
      systemPrompt,
      task: taskPrompt,
    };

    logger.info(
      { repo: task.repo, issueNumber: issue.number, worker: task.agent.getName() },
      "Starting task execution"
    );

    const result = await task.agent.execute(context);

    if (!result.success) {
      return {
        success: false,
        branchName: task.worktree.branch,
        filesChanged: [],
        summary: "Task execution failed",
        error: result.error,
      };
    }

    const filesChanged = await this.getChangedFiles(task.worktree.path);

    if (filesChanged.length === 0) {
      return {
        success: false,
        branchName: task.worktree.branch,
        filesChanged: [],
        summary: "No changes made",
        error: "Agent did not make any changes",
      };
    }

    await this.commitAndPush(task.worktree, issue);

    return {
      success: true,
      branchName: task.worktree.branch,
      filesChanged,
      summary: this.extractSummary(result.output),
    };
  }

  async cancelTask(repo: string, issueNumber: number): Promise<void> {
    const taskKey = `${repo}:${issueNumber}`;
    const task = this.activeTasks.get(taskKey);

    if (task) {
      await task.agent.cancel();
      await this.worktreeManager.removeWorktree(repo, issueNumber);
      this.activeTasks.delete(taskKey);
      logger.info({ repo, issueNumber }, "Task cancelled");
    }
  }

  /**
   * Execute task and commit directly to main branch (for low-risk changes)
   * This skips PR creation and commits directly to main
   */
  async executeTaskDirectToMain(issue: Issue, repo: string): Promise<TaskResult> {
    const taskKey = `direct:${repo}:${issue.number}`;

    if (this.activeTasks.has(taskKey)) {
      logger.warn({ repo, issueNumber: issue.number }, "Direct task already in progress");
      return {
        success: false,
        branchName: "main",
        filesChanged: [],
        summary: "Task already in progress",
        error: "Duplicate task",
      };
    }

    const worker = this.getAvailableWorker();
    if (!worker) {
      logger.warn("No available workers for direct commit");
      return {
        success: false,
        branchName: "main",
        filesChanged: [],
        summary: "No available workers",
        error: "All workers are busy",
      };
    }

    // Create worktree on main branch for direct commit
    const worktree = await this.worktreeManager.createWorktreeForMain(
      repo,
      this.repoPath,
      issue.number
    );

    const task: ActiveTask = {
      issueNumber: issue.number,
      repo,
      worktree,
      agent: worker,
      startedAt: new Date(),
    };

    this.activeTasks.set(taskKey, task);

    try {
      const result = await this.runDirectTask(task, issue);
      return result;
    } finally {
      this.activeTasks.delete(taskKey);
    }
  }

  private async runDirectTask(task: ActiveTask, issue: Issue): Promise<TaskResult> {
    const systemPrompt = this.getSystemPrompt(issue);
    const taskPrompt = this.getTaskPrompt(issue);

    const context: AgentContext = {
      repo: task.repo,
      issueNumber: issue.number,
      workDir: task.worktree.path,
      systemPrompt,
      task: taskPrompt,
    };

    logger.info(
      { repo: task.repo, issueNumber: issue.number, worker: task.agent.getName() },
      "Starting direct-to-main task execution"
    );

    const result = await task.agent.execute(context);

    if (!result.success) {
      return {
        success: false,
        branchName: "main",
        filesChanged: [],
        summary: "Task execution failed",
        error: result.error,
        directCommit: true,
      };
    }

    const filesChanged = await this.getChangedFiles(task.worktree.path);

    if (filesChanged.length === 0) {
      return {
        success: false,
        branchName: "main",
        filesChanged: [],
        summary: "No changes made",
        error: "Agent did not make any changes",
        directCommit: true,
      };
    }

    await this.commitAndPushToMain(task.worktree, issue);

    return {
      success: true,
      branchName: "main",
      filesChanged,
      summary: this.extractSummary(result.output),
      directCommit: true,
    };
  }

  private async commitAndPushToMain(worktree: Worktree, issue: Issue): Promise<void> {
    const { spawn } = await import("node:child_process");

    const runGit = (args: string[]): Promise<void> => {
      return new Promise((resolve, reject) => {
        const proc = spawn("git", args, { cwd: worktree.path });
        proc.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`Git command failed: ${args.join(" ")}`));
        });
        proc.on("error", reject);
      });
    };

    await runGit(["add", "-A"]);

    const commitMessage = `chore: resolve issue #${issue.number}

${issue.title}

Closes #${issue.number}

🤖 Generated by Haunted AI`;

    await runGit(["commit", "-m", commitMessage]);

    await runGit(["push", "origin", "main"]);

    logger.info({ issueNumber: issue.number }, "Changes committed and pushed directly to main");
  }

  async executeRevision(pr: PullRequest, repo: string, feedback: string): Promise<TaskResult> {
    const taskKey = `revision:${repo}:${pr.number}`;

    if (this.activeTasks.has(taskKey)) {
      logger.warn({ repo, prNumber: pr.number }, "Revision already in progress");
      return {
        success: false,
        branchName: pr.headBranch,
        filesChanged: [],
        summary: "Revision already in progress",
        error: "Duplicate revision",
      };
    }

    const worker = this.getAvailableWorker();
    if (!worker) {
      logger.warn("No available workers for revision");
      return {
        success: false,
        branchName: pr.headBranch,
        filesChanged: [],
        summary: "No available workers",
        error: "All workers are busy",
      };
    }

    // Create worktree on existing PR branch
    const worktree = await this.worktreeManager.createWorktreeForRevision(
      repo,
      this.repoPath,
      pr.number,
      pr.headBranch
    );

    const task: ActiveTask = {
      issueNumber: pr.number,
      repo,
      worktree,
      agent: worker,
      startedAt: new Date(),
    };

    this.activeTasks.set(taskKey, task);

    try {
      const result = await this.runRevision(task, pr, feedback);
      return result;
    } finally {
      this.activeTasks.delete(taskKey);
    }
  }

  private async runRevision(task: ActiveTask, pr: PullRequest, feedback: string): Promise<TaskResult> {
    const systemPrompt = `You are an expert software engineer applying revisions to PR #${pr.number}.

Your task is to apply the requested changes based on user feedback. Follow these guidelines:

1. Read and understand the feedback carefully
2. Make only the changes requested - do not refactor or modify unrelated code
3. Keep the changes minimal and focused
4. Follow the project's existing coding style

After completing your changes, provide a brief summary.`;

    const taskPrompt = `Please apply the following revision to PR #${pr.number}: ${pr.title}

## User Feedback:

${feedback}

---

Please make the requested changes and provide a summary of what you modified.`;

    const context: AgentContext = {
      repo: task.repo,
      issueNumber: pr.number,
      workDir: task.worktree.path,
      systemPrompt,
      task: taskPrompt,
    };

    logger.info(
      { repo: task.repo, prNumber: pr.number, worker: task.agent.getName() },
      "Starting revision execution"
    );

    const result = await task.agent.execute(context);

    if (!result.success) {
      return {
        success: false,
        branchName: task.worktree.branch,
        filesChanged: [],
        summary: "Revision failed",
        error: result.error,
      };
    }

    const filesChanged = await this.getChangedFiles(task.worktree.path);

    if (filesChanged.length === 0) {
      return {
        success: false,
        branchName: task.worktree.branch,
        filesChanged: [],
        summary: "No changes made",
        error: "Agent did not make any changes",
      };
    }

    await this.commitAndPushRevision(task.worktree, feedback);

    return {
      success: true,
      branchName: task.worktree.branch,
      filesChanged,
      summary: this.extractSummary(result.output),
    };
  }

  private async commitAndPushRevision(worktree: Worktree, feedback: string): Promise<void> {
    const { spawn } = await import("node:child_process");

    const runGit = (args: string[]): Promise<void> => {
      return new Promise((resolve, reject) => {
        const proc = spawn("git", args, { cwd: worktree.path });
        proc.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`Git command failed: ${args.join(" ")}`));
        });
        proc.on("error", reject);
      });
    };

    await runGit(["add", "-A"]);

    const shortFeedback = feedback.slice(0, 50).replace(/\n/g, " ");
    const commitMessage = `fix: apply revision based on feedback

${shortFeedback}${feedback.length > 50 ? "..." : ""}

🤖 Generated by Haunted AI`;

    await runGit(["commit", "-m", commitMessage]);

    await runGit(["push"]);

    logger.info({ branch: worktree.branch }, "Revision committed and pushed");
  }

  private getAvailableWorker(): ClaudeCodeWorker | null {
    for (const worker of this.workers) {
      if (!worker.isActive()) {
        return worker;
      }
    }
    return null;
  }

  getActiveTaskCount(): number {
    return this.activeTasks.size;
  }

  getAvailableWorkerCount(): number {
    return this.workers.filter((w) => !w.isActive()).length;
  }

  private getSystemPrompt(issue: Issue): string {
    return `You are an expert software engineer working on GitHub issue #${issue.number}.

Your task is to implement a solution for this issue. Follow these guidelines:

1. Read and understand the issue requirements thoroughly
2. Explore the codebase to understand the existing architecture
3. Implement the solution following existing patterns and conventions
4. Write clean, well-documented code
5. Add appropriate tests if the project has tests
6. Make atomic, focused changes

Important:
- Do not modify unrelated files
- Do not introduce breaking changes unless required
- Follow the project's coding style
- If you encounter blockers, document them clearly

After completing your work, provide a brief summary of the changes you made.`;
  }

  private getTaskPrompt(issue: Issue): string {
    return `Please implement a solution for the following GitHub issue:

## Issue #${issue.number}: ${issue.title}

${issue.body}

---

Labels: ${issue.labels.join(", ") || "none"}

Please implement this and provide a summary of your changes when done.`;
  }

  private async getChangedFiles(workDir: string): Promise<string[]> {
    const { spawn } = await import("node:child_process");

    const runGitCommand = (args: string[]): Promise<string[]> => {
      return new Promise((resolve) => {
        const proc = spawn("git", args, {
          cwd: workDir,
          stdio: ["pipe", "pipe", "pipe"],
        });

        let stdout = "";
        proc.stdout.on("data", (data) => (stdout += data.toString()));
        proc.on("close", () => {
          const files = stdout.trim().split("\n").filter(Boolean);
          resolve(files);
        });
        proc.on("error", () => resolve([]));
      });
    };

    // Get both modified tracked files and untracked files
    const [trackedChanges, untrackedFiles] = await Promise.all([
      runGitCommand(["diff", "--name-only", "HEAD"]),
      runGitCommand(["ls-files", "--others", "--exclude-standard"]),
    ]);

    // Combine and deduplicate
    const allFiles = [...new Set([...trackedChanges, ...untrackedFiles])];
    return allFiles;
  }

  private async commitAndPush(worktree: Worktree, issue: Issue): Promise<void> {
    const { spawn } = await import("node:child_process");

    const runGit = (args: string[]): Promise<void> => {
      return new Promise((resolve, reject) => {
        const proc = spawn("git", args, { cwd: worktree.path });
        proc.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`Git command failed: ${args.join(" ")}`));
        });
        proc.on("error", reject);
      });
    };

    await runGit(["add", "-A"]);

    const commitMessage = `fix: resolve issue #${issue.number}

${issue.title}

Closes #${issue.number}

🤖 Generated by Haunted AI`;

    await runGit(["commit", "-m", commitMessage]);

    await runGit(["push", "-u", "origin", worktree.branch]);

    logger.info({ branch: worktree.branch, issueNumber: issue.number }, "Changes committed and pushed");
  }

  private extractSummary(output: string): string {
    const lines = output.split("\n");
    const summaryStart = lines.findIndex((l) =>
      l.toLowerCase().includes("summary") || l.toLowerCase().includes("changes made")
    );

    if (summaryStart >= 0) {
      return lines.slice(summaryStart, summaryStart + 10).join("\n");
    }

    return lines.slice(-5).join("\n");
  }

  async cleanup(): Promise<void> {
    for (const task of this.activeTasks.values()) {
      await task.agent.cancel();
    }
    await this.worktreeManager.cleanup();
    this.activeTasks.clear();
    logger.info("Agent pool cleaned up");
  }
}

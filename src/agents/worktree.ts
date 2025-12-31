import { spawn } from "node:child_process";
import { mkdir, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { createLogger } from "@/utils/logger.ts";

const logger = createLogger("worktree");

export interface Worktree {
  path: string;
  branch: string;
  issueNumber: number;
  repo: string;
  createdAt: Date;
}

export class WorktreeManager {
  private baseDir: string;
  private worktrees: Map<string, Worktree> = new Map();

  constructor(baseDir: string = "/tmp/haunted-worktrees") {
    this.baseDir = baseDir;
  }

  async init(): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
    logger.info({ baseDir: this.baseDir }, "Worktree manager initialized");
  }

  private getWorktreeKey(repo: string, issueNumber: number): string {
    return `${repo}:${issueNumber}`;
  }

  private getWorktreePath(repo: string, issueNumber: number): string {
    const safeName = repo.replace("/", "-");
    return join(this.baseDir, `${safeName}-issue-${issueNumber}`);
  }

  async createWorktree(
    repo: string,
    repoPath: string,
    issueNumber: number,
    branchName: string
  ): Promise<Worktree> {
    const key = this.getWorktreeKey(repo, issueNumber);
    const existing = this.worktrees.get(key);

    if (existing) {
      logger.debug({ repo, issueNumber }, "Worktree already exists");
      return existing;
    }

    const worktreePath = this.getWorktreePath(repo, issueNumber);

    try {
      await access(worktreePath);
      await this.removeWorktreeDir(worktreePath);
    } catch {
      // Path doesn't exist, which is fine
    }

    await this.gitFetch(repoPath);

    const branchExists = await this.gitCreateBranch(repoPath, branchName);

    await this.gitAddWorktree(repoPath, worktreePath, branchName, branchExists);

    const worktree: Worktree = {
      path: worktreePath,
      branch: branchName,
      issueNumber,
      repo,
      createdAt: new Date(),
    };

    this.worktrees.set(key, worktree);
    logger.info({ repo, issueNumber, path: worktreePath, branch: branchName }, "Worktree created");

    return worktree;
  }

  async createWorktreeForRevision(
    repo: string,
    repoPath: string,
    prNumber: number,
    branchName: string
  ): Promise<Worktree> {
    const key = `revision:${repo}:${prNumber}`;
    const existing = this.worktrees.get(key);

    if (existing) {
      logger.debug({ repo, prNumber }, "Revision worktree already exists");
      return existing;
    }

    const safeName = repo.replace("/", "-");
    const worktreePath = join(this.baseDir, `${safeName}-pr-${prNumber}`);

    try {
      await access(worktreePath);
      await this.removeWorktreeDir(worktreePath);
    } catch {
      // Path doesn't exist, which is fine
    }

    await this.gitFetch(repoPath);

    // Checkout existing remote branch
    await this.gitCheckoutRemoteBranch(repoPath, worktreePath, branchName);

    const worktree: Worktree = {
      path: worktreePath,
      branch: branchName,
      issueNumber: prNumber,
      repo,
      createdAt: new Date(),
    };

    this.worktrees.set(key, worktree);
    logger.info({ repo, prNumber, path: worktreePath, branch: branchName }, "Revision worktree created");

    return worktree;
  }

  private async gitCheckoutRemoteBranch(repoPath: string, worktreePath: string, branchName: string): Promise<void> {
    // Prune any stale worktrees first
    await this.runGit(repoPath, ["worktree", "prune"]);

    // Check if branch exists locally
    const localCheck = await this.runGit(repoPath, ["show-ref", "--verify", `refs/heads/${branchName}`]);

    if (localCheck.exitCode === 0) {
      // Local branch exists, add worktree with it
      const result = await this.runGit(repoPath, ["worktree", "add", "--force", worktreePath, branchName]);
      if (result.exitCode !== 0) {
        throw new Error(`Failed to add worktree: ${result.stderr}`);
      }
    } else {
      // Local branch doesn't exist, create from remote tracking branch
      const result = await this.runGit(repoPath, ["worktree", "add", "-b", branchName, worktreePath, `origin/${branchName}`]);
      if (result.exitCode !== 0) {
        throw new Error(`Failed to add worktree from remote: ${result.stderr}`);
      }
    }

    // Pull latest changes in the worktree
    const pullResult = await this.runGit(worktreePath, ["pull", "--rebase"]);
    if (pullResult.exitCode !== 0) {
      logger.warn({ stderr: pullResult.stderr }, "Git pull warning");
    }
  }

  async removeWorktree(repo: string, issueNumber: number): Promise<void> {
    const key = this.getWorktreeKey(repo, issueNumber);
    const worktree = this.worktrees.get(key);

    if (!worktree) {
      logger.debug({ repo, issueNumber }, "No worktree to remove");
      return;
    }

    await this.removeWorktreeDir(worktree.path);
    this.worktrees.delete(key);
    logger.info({ repo, issueNumber }, "Worktree removed");
  }

  getWorktree(repo: string, issueNumber: number): Worktree | undefined {
    return this.worktrees.get(this.getWorktreeKey(repo, issueNumber));
  }

  listWorktrees(): Worktree[] {
    return Array.from(this.worktrees.values());
  }

  getActiveCount(): number {
    return this.worktrees.size;
  }

  private async runGit(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const proc = spawn("git", args, { cwd, stdio: ["pipe", "pipe", "pipe"] });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => (stdout += data.toString()));
      proc.stderr.on("data", (data) => (stderr += data.toString()));

      proc.on("error", reject);
      proc.on("close", (code) => {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code ?? 0 });
      });
    });
  }

  private async gitFetch(repoPath: string): Promise<void> {
    const result = await this.runGit(repoPath, ["fetch", "--all"]);
    if (result.exitCode !== 0) {
      logger.warn({ stderr: result.stderr }, "Git fetch warning");
    }
  }

  private async gitCreateBranch(repoPath: string, branchName: string): Promise<boolean> {
    const checkResult = await this.runGit(repoPath, ["show-ref", "--verify", `refs/heads/${branchName}`]);

    if (checkResult.exitCode === 0) {
      logger.debug({ branch: branchName }, "Branch already exists");
      return true; // Branch exists
    }

    const result = await this.runGit(repoPath, ["branch", branchName]);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to create branch: ${result.stderr}`);
    }
    return false; // New branch created
  }

  private async gitAddWorktree(repoPath: string, worktreePath: string, branchName: string, branchExists: boolean): Promise<void> {
    // First, check if the branch is already checked out in another worktree
    const listResult = await this.runGit(repoPath, ["worktree", "list", "--porcelain"]);

    if (listResult.exitCode === 0 && listResult.stdout.includes(branchName)) {
      // Branch is in use by another worktree, remove it first
      logger.debug({ branch: branchName }, "Branch is in use by another worktree, cleaning up");
      await this.runGit(repoPath, ["worktree", "prune"]);
    }

    // If branch exists, we need to use a different approach
    let result;
    if (branchExists) {
      // First try to add worktree with existing branch
      result = await this.runGit(repoPath, ["worktree", "add", worktreePath, branchName]);

      if (result.exitCode !== 0 && result.stderr.includes("already checked out")) {
        // Force remove the old worktree lock and try again
        await this.runGit(repoPath, ["worktree", "prune"]);
        result = await this.runGit(repoPath, ["worktree", "add", "--force", worktreePath, branchName]);
      }
    } else {
      result = await this.runGit(repoPath, ["worktree", "add", worktreePath, branchName]);
    }

    if (result.exitCode !== 0) {
      throw new Error(`Failed to add worktree: ${result.stderr}`);
    }
  }

  private async removeWorktreeDir(path: string): Promise<void> {
    try {
      const parentDir = join(path, "..");
      await this.runGit(parentDir, ["worktree", "remove", path, "--force"]);
    } catch {
      // If git worktree remove fails, just delete the directory
      await rm(path, { recursive: true, force: true });
    }
  }

  async cleanup(): Promise<void> {
    for (const worktree of this.worktrees.values()) {
      try {
        await this.removeWorktreeDir(worktree.path);
      } catch (error) {
        logger.error({ error, path: worktree.path }, "Failed to cleanup worktree");
      }
    }
    this.worktrees.clear();
    logger.info("All worktrees cleaned up");
  }
}

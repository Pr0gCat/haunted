/**
 * Git Worktree Manager - Manages git worktrees for parallel issue processing
 */

import { execa } from 'execa';
import { promises as fs } from 'fs';
import * as path from 'path';
import { logger } from '../../utils/logger.js';
import type { WorktreeInfo } from '../../models/index.js';

export class WorktreeManager {
  constructor(private workDir: string) {}

  /**
   * Get the path for a repository's bare clone
   */
  private getRepoPath(repository: string): string {
    // Convert owner/repo to owner--repo for filesystem safety
    const safeName = repository.replace('/', '--');
    return path.join(this.workDir, safeName);
  }

  /**
   * Get the worktree path for an issue
   */
  private getWorktreePath(repository: string, issueNumber: number): string {
    const repoPath = this.getRepoPath(repository);
    return path.join(repoPath, 'worktrees', `issue-${issueNumber}`);
  }

  /**
   * Ensure a repository is cloned (bare clone for worktree support)
   */
  async ensureRepo(repository: string): Promise<string> {
    const repoPath = this.getRepoPath(repository);
    const gitDir = path.join(repoPath, '.git');

    try {
      await fs.access(gitDir);
      // Repo exists, fetch latest
      await execa('git', ['fetch', '--all'], { cwd: repoPath });
      logger.debug(`Fetched latest for ${repository}`);
    } catch {
      // Repo doesn't exist, clone it
      await fs.mkdir(path.dirname(repoPath), { recursive: true });
      await execa('git', [
        'clone',
        `https://github.com/${repository}.git`,
        repoPath
      ]);
      logger.info(`Cloned ${repository} to ${repoPath}`);
    }

    return repoPath;
  }

  /**
   * Create a worktree for an issue
   */
  async createWorktree(
    repository: string,
    issueNumber: number,
    baseBranch: string = 'main'
  ): Promise<WorktreeInfo> {
    const repoPath = await this.ensureRepo(repository);
    const worktreePath = this.getWorktreePath(repository, issueNumber);
    const branchName = `issue/${issueNumber}`;

    // Check if worktree already exists
    try {
      await fs.access(worktreePath);
      logger.debug(`Worktree already exists at ${worktreePath}`);
      return {
        path: worktreePath,
        branch: branchName,
        issueNumber,
        repository,
        createdAt: new Date(), // Could read from fs stats
      };
    } catch {
      // Worktree doesn't exist, create it
    }

    // Ensure worktrees directory exists
    await fs.mkdir(path.dirname(worktreePath), { recursive: true });

    // Fetch latest
    await execa('git', ['fetch', 'origin', baseBranch], { cwd: repoPath });

    // Create branch and worktree
    try {
      // Try to create new branch
      await execa('git', [
        'worktree', 'add',
        '-b', branchName,
        worktreePath,
        `origin/${baseBranch}`
      ], { cwd: repoPath });
    } catch {
      // Branch might already exist, try without -b
      try {
        await execa('git', [
          'worktree', 'add',
          worktreePath,
          branchName
        ], { cwd: repoPath });
      } catch (error) {
        logger.error(`Failed to create worktree for issue #${issueNumber}:`, error);
        throw error;
      }
    }

    logger.info(`Created worktree for ${repository}#${issueNumber} at ${worktreePath}`);

    return {
      path: worktreePath,
      branch: branchName,
      issueNumber,
      repository,
      createdAt: new Date(),
    };
  }

  /**
   * Remove a worktree
   */
  async removeWorktree(repository: string, issueNumber: number): Promise<void> {
    const repoPath = this.getRepoPath(repository);
    const worktreePath = this.getWorktreePath(repository, issueNumber);

    try {
      // Remove the worktree
      await execa('git', ['worktree', 'remove', worktreePath, '--force'], { cwd: repoPath });
      logger.info(`Removed worktree for ${repository}#${issueNumber}`);
    } catch (error) {
      logger.warn(`Failed to remove worktree at ${worktreePath}:`, error);
      // Try force removing the directory
      try {
        await fs.rm(worktreePath, { recursive: true, force: true });
        await execa('git', ['worktree', 'prune'], { cwd: repoPath });
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * List all worktrees for a repository
   */
  async listWorktrees(repository: string): Promise<WorktreeInfo[]> {
    const repoPath = this.getRepoPath(repository);

    try {
      const result = await execa('git', ['worktree', 'list', '--porcelain'], { cwd: repoPath });

      const worktrees: WorktreeInfo[] = [];
      const lines = result.stdout.split('\n');

      let currentWorktree: Partial<WorktreeInfo> = {};

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          currentWorktree.path = line.substring(9);
        } else if (line.startsWith('branch ')) {
          const branch = line.substring(7);
          currentWorktree.branch = branch.replace('refs/heads/', '');

          // Extract issue number from branch name
          const match = currentWorktree.branch?.match(/issue\/(\d+)/);
          if (match) {
            currentWorktree.issueNumber = parseInt(match[1], 10);
            currentWorktree.repository = repository;
            currentWorktree.createdAt = new Date(); // Could read from fs stats

            worktrees.push(currentWorktree as WorktreeInfo);
          }
          currentWorktree = {};
        }
      }

      return worktrees;
    } catch {
      return [];
    }
  }

  /**
   * Clean up stale worktrees (older than maxAge in milliseconds)
   */
  async cleanupStaleWorktrees(repository: string, maxAge: number): Promise<number> {
    const worktrees = await this.listWorktrees(repository);
    const now = Date.now();
    let cleaned = 0;

    for (const worktree of worktrees) {
      try {
        const stats = await fs.stat(worktree.path);
        const age = now - stats.mtimeMs;

        if (age > maxAge) {
          await this.removeWorktree(repository, worktree.issueNumber);
          cleaned++;
        }
      } catch {
        // Ignore errors for individual worktrees
      }
    }

    if (cleaned > 0) {
      logger.info(`Cleaned up ${cleaned} stale worktrees for ${repository}`);
    }

    return cleaned;
  }

  /**
   * Get worktree info for an issue
   */
  async getWorktree(repository: string, issueNumber: number): Promise<WorktreeInfo | null> {
    const worktreePath = this.getWorktreePath(repository, issueNumber);

    try {
      await fs.access(worktreePath);

      return {
        path: worktreePath,
        branch: `issue/${issueNumber}`,
        issueNumber,
        repository,
        createdAt: new Date(),
      };
    } catch {
      return null;
    }
  }

  /**
   * Commit and push changes in a worktree
   */
  async commitAndPush(
    worktreePath: string,
    message: string,
    options: { add?: boolean } = {}
  ): Promise<void> {
    if (options.add) {
      await execa('git', ['add', '-A'], { cwd: worktreePath });
    }

    // Check if there are changes to commit
    const status = await execa('git', ['status', '--porcelain'], { cwd: worktreePath });
    if (!status.stdout.trim()) {
      logger.debug('No changes to commit');
      return;
    }

    await execa('git', ['commit', '-m', message], { cwd: worktreePath });

    // Get current branch
    const branchResult = await execa('git', ['branch', '--show-current'], { cwd: worktreePath });
    const branch = branchResult.stdout.trim();

    // Push to origin
    await execa('git', ['push', '-u', 'origin', branch], { cwd: worktreePath });

    logger.info(`Committed and pushed changes to ${branch}`);
  }
}

export default WorktreeManager;

/**
 * Git Service - Git operations wrapper
 */

import { execa } from 'execa';
import { logger } from '../../utils/logger.js';
import type { GitStatus } from '../../models/index.js';

export { WorktreeManager } from './worktree.js';

export class GitService {
  constructor(private workingDir: string) {}

  /**
   * Get current git status
   */
  async getStatus(): Promise<GitStatus> {
    const branchResult = await execa('git', ['branch', '--show-current'], {
      cwd: this.workingDir,
    });

    const statusResult = await execa('git', ['status', '--porcelain'], {
      cwd: this.workingDir,
    });

    const lines = statusResult.stdout.split('\n').filter(l => l.trim());

    const untrackedFiles: string[] = [];
    const modifiedFiles: string[] = [];
    let hasConflicts = false;

    for (const line of lines) {
      const status = line.substring(0, 2);
      const file = line.substring(3);

      if (status === '??') {
        untrackedFiles.push(file);
      } else if (status.includes('U') || status === 'AA' || status === 'DD') {
        hasConflicts = true;
        modifiedFiles.push(file);
      } else {
        modifiedFiles.push(file);
      }
    }

    return {
      currentBranch: branchResult.stdout.trim(),
      isDirty: lines.length > 0,
      untrackedFiles,
      modifiedFiles,
      hasConflicts,
    };
  }

  /**
   * Create a new branch from a base branch
   */
  async createBranch(branchName: string, baseBranch: string = 'main'): Promise<void> {
    // Fetch latest
    await execa('git', ['fetch', 'origin', baseBranch], { cwd: this.workingDir });

    // Create and checkout new branch
    await execa('git', ['checkout', '-b', branchName, `origin/${baseBranch}`], {
      cwd: this.workingDir,
    });

    logger.info(`Created branch ${branchName} from ${baseBranch}`);
  }

  /**
   * Switch to an existing branch
   */
  async switchToBranch(branchName: string): Promise<void> {
    await execa('git', ['checkout', branchName], { cwd: this.workingDir });
    logger.debug(`Switched to branch ${branchName}`);
  }

  /**
   * Commit all changes
   */
  async commit(message: string, addAll: boolean = true): Promise<string | null> {
    if (addAll) {
      await execa('git', ['add', '-A'], { cwd: this.workingDir });
    }

    // Check if there are changes to commit
    const status = await execa('git', ['status', '--porcelain'], { cwd: this.workingDir });
    if (!status.stdout.trim()) {
      logger.debug('No changes to commit');
      return null;
    }

    const result = await execa('git', ['commit', '-m', message], { cwd: this.workingDir });

    // Extract commit hash
    const match = result.stdout.match(/\[[\w-]+ ([a-f0-9]+)\]/);
    const commitHash = match ? match[1] : 'unknown';

    logger.info(`Created commit ${commitHash}: ${message}`);
    return commitHash;
  }

  /**
   * Push current branch to origin
   */
  async push(force: boolean = false): Promise<void> {
    const branchResult = await execa('git', ['branch', '--show-current'], {
      cwd: this.workingDir,
    });
    const branch = branchResult.stdout.trim();

    const args = ['push', '-u', 'origin', branch];
    if (force) {
      args.splice(1, 0, '--force-with-lease');
    }

    await execa('git', args, { cwd: this.workingDir });
    logger.info(`Pushed to origin/${branch}`);
  }

  /**
   * Pull latest changes
   */
  async pull(): Promise<void> {
    await execa('git', ['pull'], { cwd: this.workingDir });
    logger.debug('Pulled latest changes');
  }

  /**
   * Get the default branch name
   */
  async getDefaultBranch(): Promise<string> {
    try {
      const result = await execa('git', [
        'symbolic-ref', 'refs/remotes/origin/HEAD', '--short'
      ], { cwd: this.workingDir });
      return result.stdout.trim().replace('origin/', '');
    } catch {
      // Fallback to common defaults
      try {
        await execa('git', ['rev-parse', '--verify', 'origin/main'], { cwd: this.workingDir });
        return 'main';
      } catch {
        return 'master';
      }
    }
  }

  /**
   * Check if a branch exists
   */
  async branchExists(branchName: string): Promise<boolean> {
    try {
      await execa('git', ['rev-parse', '--verify', branchName], { cwd: this.workingDir });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete a branch
   */
  async deleteBranch(branchName: string, force: boolean = false): Promise<void> {
    const flag = force ? '-D' : '-d';
    await execa('git', ['branch', flag, branchName], { cwd: this.workingDir });
    logger.info(`Deleted branch ${branchName}`);
  }

  /**
   * Delete a remote branch
   */
  async deleteRemoteBranch(branchName: string): Promise<void> {
    await execa('git', ['push', 'origin', '--delete', branchName], { cwd: this.workingDir });
    logger.info(`Deleted remote branch ${branchName}`);
  }

  /**
   * Get diff of current changes
   */
  async getDiff(staged: boolean = false): Promise<string> {
    const args = staged ? ['diff', '--staged'] : ['diff'];
    const result = await execa('git', args, { cwd: this.workingDir });
    return result.stdout;
  }

  /**
   * Get list of changed files compared to a branch
   */
  async getChangedFiles(baseBranch: string = 'main'): Promise<string[]> {
    const result = await execa('git', [
      'diff', '--name-only', `origin/${baseBranch}...HEAD`
    ], { cwd: this.workingDir });

    return result.stdout.split('\n').filter(f => f.trim());
  }
}

export default GitService;

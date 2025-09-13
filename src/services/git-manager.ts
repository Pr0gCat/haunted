/**
 * Git Manager - Git repository operations using simple-git
 */

import { simpleGit, SimpleGit, SimpleGitOptions } from 'simple-git';
import path from 'path';
import type { GitStatus } from '../models/index.js';
import { logger } from '../utils/logger.js';

export class GitManager {
  private git: SimpleGit;
  private projectRoot: string;

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = path.resolve(projectRoot);

    const options: Partial<SimpleGitOptions> = {
      baseDir: this.projectRoot,
      binary: 'git',
      maxConcurrentProcesses: 6,
      trimmed: false,
    };

    this.git = simpleGit(options);
  }

  async initialize(): Promise<void> {
    try {
      // Check if we're in a git repository
      const isRepo = await this.git.checkIsRepo();
      if (!isRepo) {
        throw new Error('Not a git repository');
      }

      logger.info(`Git manager initialized for ${this.projectRoot}`);
    } catch (error) {
      logger.error('Git manager initialization failed:', error);
      throw error;
    }
  }

  async initializeRepo(): Promise<void> {
    try {
      await this.git.init();

      // Create initial commit if repository is empty
      const status = await this.git.status();
      if (status.files.length === 0) {
        // Create a basic .gitignore if it doesn't exist
        try {
          const fs = await import('fs/promises');
          const gitignorePath = path.join(this.projectRoot, '.gitignore');

          try {
            await fs.access(gitignorePath);
          } catch {
            // .gitignore doesn't exist, create it
            const defaultGitignore = `
# Dependencies
node_modules/
.pnp
.pnp.js

# Testing
coverage/

# Production
build/
dist/

# Environment
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# Logs
npm-debug.log*
yarn-debug.log*
yarn-error.log*
lerna-debug.log*

# OS generated files
.DS_Store
.DS_Store?
._*
.Spotlight-V100
.Trashes
ehthumbs.db
Thumbs.db

# IDE
.vscode/
.idea/
*.swp
*.swo

# Haunted
.haunted/
`.trim();

            await fs.writeFile(gitignorePath, defaultGitignore, 'utf8');
            await this.git.add('.gitignore');
          }
        } catch (error) {
          logger.warn('Failed to create .gitignore:', error);
        }

        // Create initial commit
        await this.git.commit('Initial commit');
        logger.info('Created initial commit');
      }

      logger.info('Git repository initialized');
    } catch (error) {
      logger.error('Git repository initialization failed:', error);
      throw error;
    }
  }

  async getCurrentBranch(): Promise<string> {
    try {
      const status = await this.git.status();
      return status.current || 'main';
    } catch (error) {
      logger.error('Failed to get current branch:', error);
      throw error;
    }
  }

  async createBranch(branchName: string, from: string = 'main'): Promise<void> {
    try {
      // Check if branch already exists
      const branches = await this.git.branch();
      if (branches.all.includes(branchName)) {
        logger.info(`Branch ${branchName} already exists`);
        return;
      }

      // Ensure we're on the base branch
      await this.git.checkout(from);

      // Create and checkout new branch
      await this.git.checkoutLocalBranch(branchName);

      logger.info(`Created branch: ${branchName} from ${from}`);
    } catch (error) {
      logger.error(`Failed to create branch ${branchName}:`, error);
      throw error;
    }
  }

  async switchToBranch(branchName: string): Promise<void> {
    try {
      await this.git.checkout(branchName);
      logger.info(`Switched to branch: ${branchName}`);
    } catch (error) {
      logger.error(`Failed to switch to branch ${branchName}:`, error);
      throw error;
    }
  }

  async mergeBranch(branchName: string, targetBranch: string = 'main'): Promise<void> {
    try {
      // Switch to target branch
      await this.git.checkout(targetBranch);

      // Merge the branch
      await this.git.merge([branchName]);

      logger.info(`Merged branch ${branchName} into ${targetBranch}`);
    } catch (error) {
      logger.error(`Failed to merge branch ${branchName} into ${targetBranch}:`, error);
      throw error;
    }
  }

  async deleteBranch(branchName: string, force: boolean = false): Promise<void> {
    try {
      // Make sure we're not on the branch we want to delete
      const currentBranch = await this.getCurrentBranch();
      if (currentBranch === branchName) {
        await this.git.checkout('main');
      }

      // Delete the branch
      if (force) {
        await this.git.deleteLocalBranch(branchName, true);
      } else {
        await this.git.deleteLocalBranch(branchName);
      }

      logger.info(`Deleted branch: ${branchName}`);
    } catch (error) {
      logger.error(`Failed to delete branch ${branchName}:`, error);
      throw error;
    }
  }

  async getRepositoryStatus(): Promise<GitStatus> {
    try {
      const status = await this.git.status();

      return {
        currentBranch: status.current || 'main',
        isDirty: !status.isClean(),
        untrackedFiles: status.not_added,
        modifiedFiles: [...status.modified, ...status.staged],
        hasConflicts: status.conflicted.length > 0
      };
    } catch (error) {
      logger.error('Failed to get repository status:', error);
      throw error;
    }
  }

  async commitChanges(message: string, files?: string[]): Promise<void> {
    try {
      // Add files
      if (files && files.length > 0) {
        await this.git.add(files);
      } else {
        await this.git.add('.');
      }

      // Commit
      await this.git.commit(message);

      logger.info(`Committed changes: ${message}`);
    } catch (error) {
      logger.error('Failed to commit changes:', error);
      throw error;
    }
  }

  async pushChanges(branchName?: string): Promise<void> {
    try {
      const currentBranch = branchName || await this.getCurrentBranch();

      // Push to origin
      await this.git.push('origin', currentBranch);

      logger.info(`Pushed changes to origin/${currentBranch}`);
    } catch (error) {
      logger.error('Failed to push changes:', error);
      throw error;
    }
  }

  async pullChanges(branchName?: string): Promise<void> {
    try {
      const currentBranch = branchName || await this.getCurrentBranch();

      // Pull from origin
      await this.git.pull('origin', currentBranch);

      logger.info(`Pulled changes from origin/${currentBranch}`);
    } catch (error) {
      logger.error('Failed to pull changes:', error);
      throw error;
    }
  }

  async getCurrentCommitHash(): Promise<string> {
    try {
      const log = await this.git.log({ maxCount: 1 });
      return log.latest?.hash || '';
    } catch (error) {
      logger.error('Failed to get current commit hash:', error);
      throw error;
    }
  }

  async getCommitHistory(limit: number = 10): Promise<any[]> {
    try {
      const log = await this.git.log({ maxCount: limit });
      return [...log.all];
    } catch (error) {
      logger.error('Failed to get commit history:', error);
      throw error;
    }
  }

  async getBranches(): Promise<{ local: string[], remote: string[], current: string }> {
    try {
      const branches = await this.git.branch();

      return {
        local: branches.all.filter(b => !b.startsWith('remotes/')),
        remote: branches.all.filter(b => b.startsWith('remotes/')),
        current: branches.current || 'main'
      };
    } catch (error) {
      logger.error('Failed to get branches:', error);
      throw error;
    }
  }

  async getDiff(file?: string): Promise<string> {
    try {
      if (file) {
        return await this.git.diff([file]);
      } else {
        return await this.git.diff();
      }
    } catch (error) {
      logger.error('Failed to get diff:', error);
      throw error;
    }
  }

  async stashChanges(message?: string): Promise<void> {
    try {
      await this.git.stash(['push', '-m', message || 'Haunted stash']);
      logger.info('Stashed changes');
    } catch (error) {
      logger.error('Failed to stash changes:', error);
      throw error;
    }
  }

  async unstashChanges(): Promise<void> {
    try {
      await this.git.stash(['pop']);
      logger.info('Unstashed changes');
    } catch (error) {
      logger.error('Failed to unstash changes:', error);
      throw error;
    }
  }

  async isClean(): Promise<boolean> {
    try {
      const status = await this.git.status();
      return status.isClean();
    } catch (error) {
      logger.error('Failed to check if repository is clean:', error);
      return false;
    }
  }

  async hasUncommittedChanges(): Promise<boolean> {
    try {
      const isClean = await this.isClean();
      return !isClean;
    } catch (error) {
      logger.error('Failed to check for uncommitted changes:', error);
      return true; // Assume there are changes if we can't check
    }
  }
}
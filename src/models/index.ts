/**
 * Haunted Data Models
 */

// Re-export GitHub models
export * from './github.js';

export interface HauntedConfig {
  // GitHub settings
  github: {
    allowedUsers?: string[];  // If empty, uses collaborators
    triggerLabel: string;
    projectName: string;
  };
  // Runner settings
  runner: {
    maxConcurrent: number;
    workDir: string;
  };
  // Workflow settings
  workflow: {
    maxRetries: number;
    testCommands?: string[];
  };
  // Logging settings
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    file?: string;
  };
}

export const DEFAULT_CONFIG: HauntedConfig = {
  github: {
    triggerLabel: 'haunted',
    projectName: 'Haunted Development',
  },
  runner: {
    maxConcurrent: 3,
    workDir: '/work',
  },
  workflow: {
    maxRetries: 3,
  },
  logging: {
    level: 'info',
  },
};

/**
 * Tracked Issue - Internal representation of a GitHub issue being processed
 */
export interface TrackedIssue {
  id: string;                    // Internal ID
  githubNumber: number;          // GitHub issue number
  repository: string;            // owner/repo
  title: string;
  description: string;
  author: string;
  status: TrackedIssueStatus;
  workflowStage: WorkflowStage;
  branchName: string;
  worktreePath?: string;
  prNumber?: number;
  plan?: string;
  iterationCount: number;
  errorLog?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type TrackedIssueStatus = 'pending' | 'processing' | 'waiting_approval' | 'blocked' | 'completed';

/**
 * Workflow Stages - Simplified for GitHub integration
 */
export enum WorkflowStage {
  PLANNING = 'planning',
  IMPLEMENTING = 'implementing',
  TESTING = 'testing',
  REVIEW = 'review',
  DONE = 'done'
}

/**
 * Runner state
 */
export interface RunnerState {
  id: string;
  status: 'idle' | 'busy' | 'error';
  currentIssue?: TrackedIssue;
  startedAt?: Date;
}

/**
 * Task Queue Item
 */
export interface QueuedTask {
  id: string;
  type: 'process_issue' | 'handle_comment' | 'handle_review';
  repository: string;
  issueNumber: number;
  priority: number;
  payload: Record<string, unknown>;
  createdAt: Date;
}

/**
 * Worktree info
 */
export interface WorktreeInfo {
  path: string;
  branch: string;
  issueNumber: number;
  repository: string;
  createdAt: Date;
}

/**
 * Git Status
 */
export interface GitStatus {
  currentBranch: string;
  isDirty: boolean;
  untrackedFiles: string[];
  modifiedFiles: string[];
  hasConflicts: boolean;
}

/**
 * Legacy exports for backward compatibility during migration
 * TODO: Remove after full migration
 */
export interface Issue {
  id: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'in_progress' | 'blocked' | 'closed';
  workflowStage: WorkflowStage;
  phaseId?: string;
  branchName: string;
  plan?: string;
  implementation?: string;
  diagnosisLog?: string;
  iterationCount: number;
  createdAt: Date;
  updatedAt: Date;
}
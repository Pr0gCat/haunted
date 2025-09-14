/**
 * Haunted Data Models
 */

export interface HauntedConfig {
  workflow: {
    autoProcess: boolean;
    checkInterval: number;
    maxRetries: number;
  };
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    file?: string;
  };
}

export interface Phase {
  id: string;
  name: string;
  description?: string;
  status: 'planning' | 'active' | 'completed' | 'archived';
  branchName: string;
  createdAt: Date;
  updatedAt: Date;
}

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

export enum WorkflowStage {
  PLAN = 'plan',
  IMPLEMENT = 'implement',
  UNIT_TEST = 'unit_test',
  FIX_ISSUES = 'fix_issues',
  INTEGRATION_TEST = 'integration_test',
  DIAGNOSE = 'diagnose',
  DONE = 'done'
}

export interface Task {
  id: string;
  issueId: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  output?: string;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Comment {
  id: string;
  issueId: string;
  author: string;
  content: string;
  createdAt: Date;
}

export interface WorkflowRun {
  id: string;
  issueId: string;
  stage: WorkflowStage;
  status: 'running' | 'completed' | 'failed';
  startedAt: Date;
  completedAt?: Date;
  error?: string;
  output?: any;
}

export interface IssueStats {
  open: number;
  in_progress: number;
  blocked: number;
  closed: number;
  workflowStages: Record<WorkflowStage, number>;
}

export interface GitStatus {
  currentBranch: string;
  isDirty: boolean;
  untrackedFiles: string[];
  modifiedFiles: string[];
  hasConflicts: boolean;
}
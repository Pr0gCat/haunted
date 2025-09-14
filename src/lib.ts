/**
 * Haunted Library API
 * Provides high-level API for integrating Haunted into other applications
 */

import { DatabaseManager } from './services/database.js';
import { GitManager } from './services/git-manager.js';
import { ClaudeCodeWrapper } from './services/claude-wrapper.js';
import { WorkflowEngine } from './services/workflow-engine.js';
import { ConfigManager } from './utils/config.js';
import type { HauntedConfig, Issue, Phase } from './models/index.js';

export class HauntedAPI {
  private db: DatabaseManager;
  private git: GitManager;
  private claude: ClaudeCodeWrapper;
  private workflow: WorkflowEngine;

  constructor(config?: Partial<HauntedConfig>) {
    const configManager = new ConfigManager();
    configManager.loadConfig(config); // Load config to apply overrides

    this.db = new DatabaseManager(configManager.getDatabasePath());
    this.git = new GitManager(configManager.getProjectRoot());
    this.claude = new ClaudeCodeWrapper();
    this.workflow = new WorkflowEngine(this.db, this.git, this.claude);
  }

  async initialize(): Promise<void> {
    await this.db.initialize();
  }

  // Phase management
  async createPhase(name: string, description?: string): Promise<Phase> {
    return this.db.createPhase(name, description);
  }

  async listPhases(): Promise<Phase[]> {
    return this.db.listPhases();
  }

  // Issue management
  async createIssue(
    title: string,
    description: string,
    priority?: 'low' | 'medium' | 'high' | 'critical',
    phaseId?: string
  ): Promise<Issue> {
    return this.db.createIssue(title, description, priority, phaseId);
  }

  async listIssues(status?: string, stage?: string): Promise<Issue[]> {
    return this.db.listIssues(status, stage);
  }

  async getIssue(id: string): Promise<Issue | null> {
    return this.db.getIssue(id);
  }

  async updateIssueStatus(id: string, status: string): Promise<void> {
    return this.db.updateIssueStatus(id, status);
  }

  // Workflow
  async processIssue(issueId: string): Promise<void> {
    const issue = await this.db.getIssue(issueId);
    if (!issue) {
      throw new Error(`Issue ${issueId} not found`);
    }
    await this.workflow.processIssue(issue);
  }

  // Git operations
  async getCurrentBranch(): Promise<string> {
    return this.git.getCurrentBranch();
  }

  async createBranch(name: string, from?: string): Promise<void> {
    return this.git.createBranch(name, from);
  }

  async getRepositoryStatus(): Promise<any> {
    return this.git.getRepositoryStatus();
  }

  // Claude operations
  async checkClaudeAvailability(): Promise<boolean> {
    return this.claude.checkAvailability();
  }

  async analyzeAndPlan(issue: Issue): Promise<any> {
    return this.claude.analyzeAndPlan(issue);
  }

  async implementSolution(issue: Issue): Promise<any> {
    return this.claude.implementSolution(issue);
  }
}

export * from './models/index.js';
export { HauntedConfig } from './models/index.js';
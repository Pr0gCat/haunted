/**
 * Haunted Daemon - Background service for processing issues
 */

import EventEmitter from 'events';
import chalk from 'chalk';
import type { HauntedConfig, Issue } from '../models/index.js';
import { DatabaseManager } from './database.js';
import { GitManager } from './git-manager.js';
import { ClaudeCodeWrapper } from './claude-wrapper.js';
import { WorkflowEngine } from './workflow-engine.js';
import { logger } from '../utils/logger.js';

export interface DaemonStats {
  startTime: Date;
  issuesProcessed: number;
  successfulRuns: number;
  failedRuns: number;
  lastCheck: Date | null;
  isRunning: boolean;
}

export class HauntedDaemon extends EventEmitter {
  private db!: DatabaseManager;
  private git!: GitManager;
  private claude!: ClaudeCodeWrapper;
  private workflow!: WorkflowEngine;
  private config: HauntedConfig;

  private intervalId: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private stats: DaemonStats;

  constructor(config: HauntedConfig) {
    super();
    this.config = config;

    this.stats = {
      startTime: new Date(),
      issuesProcessed: 0,
      successfulRuns: 0,
      failedRuns: 0,
      lastCheck: null,
      isRunning: false
    };
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Daemon is already running');
      return;
    }

    try {
      await this.initialize();

      this.isRunning = true;
      this.stats.isRunning = true;
      this.stats.startTime = new Date();

      logger.info('Haunted daemon starting...');
      console.log(chalk.green('✨ Haunted daemon started'));
      console.log(chalk.dim(`Checking for issues every ${this.config.workflow.checkInterval}ms`));

      // Start the main processing loop
      if (this.config.workflow.autoProcess) {
        this.startProcessingLoop();
      }

      // Emit start event
      this.emit('start');

      // Keep the process alive
      await this.waitForShutdown();

    } catch (error) {
      logger.error('Failed to start daemon:', error);
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      logger.warn('Daemon is not running');
      return;
    }

    logger.info('Stopping Haunted daemon...');

    this.isRunning = false;
    this.stats.isRunning = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    // Close database connection
    if (this.db) {
      await this.db.close();
    }

    console.log(chalk.yellow('Haunted daemon stopped'));
    this.emit('stop');
  }

  getStats(): DaemonStats {
    return { ...this.stats };
  }

  async processNextIssue(): Promise<boolean> {
    try {
      // Find the next issue to process
      const openIssues = await this.db.listIssues('open');
      const inProgressIssues = await this.db.listIssues('in_progress');

      // Prioritize in-progress issues, then open issues
      const issuesToProcess = [...inProgressIssues, ...openIssues];

      if (issuesToProcess.length === 0) {
        logger.debug('No issues to process');
        return false;
      }

      // Process the highest priority issue
      const issue = this.selectNextIssue(issuesToProcess);

      if (!issue) {
        logger.debug('No suitable issue found for processing');
        return false;
      }

      await this.processIssue(issue);
      return true;

    } catch (error) {
      logger.error('Error processing next issue:', error);
      this.stats.failedRuns++;
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  }

  private async initialize(): Promise<void> {
    try {
      // Initialize database
      this.db = new DatabaseManager(this.config.database.url);
      await this.db.initialize();

      // Initialize git manager
      this.git = new GitManager(this.config.project.root);
      await this.git.initialize();

      // Initialize Claude wrapper
      this.claude = new ClaudeCodeWrapper(this.config.claude.command);

      // Check Claude availability
      const isClaudeAvailable = await this.claude.checkAvailability();
      if (!isClaudeAvailable) {
        logger.warn('Claude Code CLI not available - some features may not work');
      }

      // Initialize workflow engine
      this.workflow = new WorkflowEngine(this.db, this.git, this.claude);

      logger.info('Daemon initialized successfully');

    } catch (error) {
      logger.error('Daemon initialization failed:', error);
      throw error;
    }
  }

  private startProcessingLoop(): void {
    this.intervalId = setInterval(async () => {
      if (!this.isRunning) {
        return;
      }

      this.stats.lastCheck = new Date();

      try {
        const hasWork = await this.processNextIssue();

        if (hasWork) {
          this.stats.successfulRuns++;
          // Note: actual issue-processed event is emitted in processIssue
        }

      } catch (error) {
        logger.error('Processing loop error:', error);
        this.stats.failedRuns++;
        this.emit('error', error instanceof Error ? error : new Error(String(error)));
      }

    }, this.config.workflow.checkInterval);
  }

  private selectNextIssue(issues: Issue[]): Issue | null {
    if (issues.length === 0) {
      return null;
    }

    // Priority order
    const priorityOrder: Record<string, number> = {
      critical: 4,
      high: 3,
      medium: 2,
      low: 1
    };

    // Sort by priority (highest first), then by creation date (oldest first)
    const sortedIssues = issues.sort((a, b) => {
      const priorityA = priorityOrder[a.priority] || 0;
      const priorityB = priorityOrder[b.priority] || 0;

      if (priorityA !== priorityB) {
        return priorityB - priorityA; // Higher priority first
      }

      // Same priority, sort by creation date (oldest first)
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

    return sortedIssues[0] || null;
  }

  private async processIssue(issue: Issue): Promise<void> {
    logger.info(`Processing issue ${issue.id}: ${issue.title}`);

    try {
      // Update issue status
      if (issue.status === 'open') {
        await this.db.updateIssueStatus(issue.id, 'in_progress');
      }

      // Process through workflow
      const result = await this.workflow.processIssue(issue);

      this.stats.issuesProcessed++;

      logger.info(`Successfully processed issue ${issue.id}`);
      console.log(chalk.green(`✓ Processed issue: ${issue.title}`));

      this.emit('issue-processed', { issue, result });

    } catch (error) {
      logger.error(`Failed to process issue ${issue.id}:`, error);
      console.log(chalk.red(`✗ Failed to process issue: ${issue.title}`));

      // Update issue status to blocked
      try {
        await this.db.updateIssueStatus(issue.id, 'blocked');
        await this.db.addComment(
          issue.id,
          'ai',
          `Processing failed: ${error instanceof Error ? error.message : String(error)}`
        );
      } catch (dbError) {
        logger.error('Failed to update issue after processing error:', dbError);
      }

      this.emit('issue-failed', { issue, error });
      throw error;
    }
  }

  private async waitForShutdown(): Promise<void> {
    return new Promise((resolve) => {
      const checkShutdown = () => {
        if (!this.isRunning) {
          resolve();
        } else {
          setTimeout(checkShutdown, 1000);
        }
      };

      checkShutdown();
    });
  }

  // Event handlers for external monitoring
  on(event: 'start', listener: () => void): this;
  on(event: 'stop', listener: () => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'issue-processed', listener: (data: { issue: Issue; result: any }) => void): this;
  on(event: 'issue-failed', listener: (data: { issue: Issue; error: any }) => void): this;
  on(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  emit(event: 'start'): boolean;
  emit(event: 'stop'): boolean;
  emit(event: 'error', error: Error): boolean;
  emit(event: 'issue-processed', data: { issue: Issue; result: any }): boolean;
  emit(event: 'issue-failed', data: { issue: Issue; error: any }): boolean;
  emit(event: string | symbol, ...args: any[]): boolean {
    return super.emit(event, ...args);
  }
}
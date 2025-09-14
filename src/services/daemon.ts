/**
 * Haunted Daemon - Background service for processing issues
 */

import EventEmitter from 'events';
import path from 'path';
import chalk from 'chalk';
import type { HauntedConfig, Issue } from '../models/index.js';
import { WorkflowStage } from '../models/index.js';
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
  private recentlyProcessedIssues: Map<string, number> = new Map(); // issueId -> timestamp

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
      logger.debug('Starting issue processing cycle');

      // Find the next issue to process
      logger.debug('Fetching open and in-progress issues from database');
      const openIssues = await this.db.listIssues('open');
      const inProgressIssues = await this.db.listIssues('in_progress');

      logger.debug(`Found ${openIssues.length} open issues and ${inProgressIssues.length} in-progress issues`);

      // Filter out issues that are in done state or closed
      const validOpenIssues = openIssues.filter(issue =>
        issue.workflowStage !== WorkflowStage.DONE &&
        issue.status !== 'closed'
      );
      const validInProgressIssues = inProgressIssues.filter(issue =>
        issue.workflowStage !== WorkflowStage.DONE &&
        issue.status !== 'closed'
      );

      logger.debug(`After filtering: ${validOpenIssues.length} valid open issues and ${validInProgressIssues.length} valid in-progress issues`);

      // Prioritize in-progress issues, then open issues
      const issuesToProcess = [...validInProgressIssues, ...validOpenIssues];

      if (issuesToProcess.length === 0) {
        logger.debug('No issues to process - daemon idle');
        return false;
      }

      logger.debug(`Total issues available for processing: ${issuesToProcess.length}`);

      // Process the highest priority issue
      const issue = this.selectNextIssue(issuesToProcess);

      if (!issue) {
        logger.debug('No suitable issue found for processing after priority filtering');
        return false;
      }

      logger.info(`Selected issue for processing: ${issue.id} (${issue.title}) - Priority: ${issue.priority}, Stage: ${issue.workflowStage}`);

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
      logger.info('Starting daemon initialization...');

      // Initialize database
      const dbPath = path.join(process.cwd(), '.haunted', 'database.db');
      logger.debug(`Initializing database with URL: ${dbPath}`);
      this.db = new DatabaseManager(dbPath);
      await this.db.initialize();
      logger.debug('Database manager initialized successfully');

      // Initialize git manager
      const projectRoot = process.cwd();
      logger.debug(`Initializing git manager for project root: ${projectRoot}`);
      this.git = new GitManager(projectRoot);
      await this.git.initialize();
      logger.debug('Git manager initialized successfully');

      // Initialize Claude wrapper
      logger.debug(`Initializing Claude wrapper with default command`);
      this.claude = new ClaudeCodeWrapper('claude');

      // Check Claude availability
      logger.debug('Checking Claude Code CLI availability...');
      const isClaudeAvailable = await this.claude.checkAvailability();
      if (!isClaudeAvailable) {
        logger.warn('Claude Code CLI not available - some features may not work');
      } else {
        logger.debug('Claude Code CLI is available and ready');
      }

      // Initialize workflow engine
      logger.debug('Initializing workflow engine...');
      this.workflow = new WorkflowEngine(this.db, this.git, this.claude);
      logger.debug('Workflow engine initialized successfully');

      logger.info('Daemon initialized successfully');

    } catch (error) {
      logger.error('Daemon initialization failed:', error);
      throw error;
    }
  }

  private startProcessingLoop(): void {
    logger.info(`Starting processing loop with ${this.config.workflow.checkInterval}ms interval`);

    this.intervalId = setInterval(async () => {
      if (!this.isRunning) {
        logger.debug('Processing loop stopped - daemon not running');
        return;
      }

      this.stats.lastCheck = new Date();
      logger.debug(`Processing loop tick - checking for work (runs: ${this.stats.successfulRuns}/${this.stats.failedRuns})`);

      try {
        const hasWork = await this.processNextIssue();

        if (hasWork) {
          this.stats.successfulRuns++;
          logger.debug(`Processing cycle completed successfully (total successful runs: ${this.stats.successfulRuns})`);
          // Note: actual issue-processed event is emitted in processIssue
        } else {
          logger.debug('No work available in this processing cycle');
        }

      } catch (error) {
        logger.error('Processing loop error:', error);
        this.stats.failedRuns++;
        logger.debug(`Processing cycle failed (total failed runs: ${this.stats.failedRuns})`);
        this.emit('error', error instanceof Error ? error : new Error(String(error)));
      }

    }, this.config.workflow.checkInterval);

    logger.debug(`Processing loop interval set to ${this.config.workflow.checkInterval}ms`);
  }

  private selectNextIssue(issues: Issue[]): Issue | null {
    if (issues.length === 0) {
      logger.debug('No issues provided for selection');
      return null;
    }

    // Clean up old entries (older than 5 minutes)
    const now = Date.now();
    const COOLDOWN_PERIOD = 5 * 60 * 1000; // 5 minutes
    for (const [issueId, timestamp] of this.recentlyProcessedIssues) {
      if (now - timestamp > COOLDOWN_PERIOD) {
        this.recentlyProcessedIssues.delete(issueId);
      }
    }

    // Filter out recently processed issues
    const availableIssues = issues.filter(issue => {
      const lastProcessed = this.recentlyProcessedIssues.get(issue.id);
      if (lastProcessed) {
        const timeSinceProcessed = now - lastProcessed;
        if (timeSinceProcessed < COOLDOWN_PERIOD) {
          logger.debug(`Skipping issue ${issue.id} - processed ${Math.round(timeSinceProcessed / 1000)}s ago (cooldown: ${COOLDOWN_PERIOD / 1000}s)`);
          return false;
        }
      }
      return true;
    });

    if (availableIssues.length === 0) {
      logger.debug('No available issues after filtering recently processed ones');
      return null;
    }

    logger.debug(`Selecting next issue from ${availableIssues.length} available candidates (${issues.length} total)`);

    // Priority order
    const priorityOrder: Record<string, number> = {
      critical: 4,
      high: 3,
      medium: 2,
      low: 1
    };

    // Log issue priorities for debugging
    availableIssues.forEach(issue => {
      logger.debug(`Issue ${issue.id}: priority=${issue.priority}, stage=${issue.workflowStage}, created=${issue.createdAt.toISOString()}`);
    });

    // Sort by priority (highest first), then by creation date (oldest first)
    const sortedIssues = availableIssues.sort((a, b) => {
      const priorityA = priorityOrder[a.priority] || 0;
      const priorityB = priorityOrder[b.priority] || 0;

      if (priorityA !== priorityB) {
        return priorityB - priorityA; // Higher priority first
      }

      // Same priority, sort by creation date (oldest first)
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

    const selected = sortedIssues[0] || null;
    if (selected) {
      logger.debug(`Selected issue ${selected.id} (${selected.title}) - Priority: ${selected.priority}, Stage: ${selected.workflowStage}`);
    }

    return selected;
  }

  private async processIssue(issue: Issue): Promise<void> {
    const startTime = new Date();
    logger.info(`Processing issue ${issue.id}: ${issue.title} (Stage: ${issue.workflowStage}, Priority: ${issue.priority})`);

    // Mark this issue as recently processed
    this.recentlyProcessedIssues.set(issue.id, Date.now());

    try {
      // Update issue status
      if (issue.status === 'open') {
        logger.debug(`Updating issue ${issue.id} status from 'open' to 'in_progress'`);
        await this.db.updateIssueStatus(issue.id, 'in_progress');
      }

      logger.debug(`Starting workflow processing for issue ${issue.id} at stage '${issue.workflowStage}'`);

      // Process through workflow
      const result = await this.workflow.processIssue(issue);

      this.stats.issuesProcessed++;

      const processingTime = new Date().getTime() - startTime.getTime();
      logger.info(`Successfully processed issue ${issue.id} in ${processingTime}ms (total processed: ${this.stats.issuesProcessed})`);
      console.log(chalk.green(`✓ Processed issue: ${issue.title} (${processingTime}ms)`));

      this.emit('issue-processed', { issue, result });

    } catch (error) {
      const processingTime = new Date().getTime() - startTime.getTime();
      logger.error(`Failed to process issue ${issue.id} after ${processingTime}ms:`, error);
      console.log(chalk.red(`✗ Failed to process issue: ${issue.title} (${processingTime}ms)`));

      // Update issue status to blocked
      try {
        logger.debug(`Updating issue ${issue.id} status to 'blocked' after processing failure`);
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
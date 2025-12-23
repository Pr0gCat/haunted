/**
 * Orchestrator - Main controller for the Haunted service
 *
 * Manages multiple runners for parallel issue processing
 */

import EventEmitter from 'events';
import { logger } from '../utils/logger.js';
import { GitHubService } from '../services/github/index.js';
import { WorkflowEngine } from '../workflow/index.js';
import {
  type HauntedConfig,
  type TrackedIssue,
  type QueuedTask,
  type RunnerState,
  type GitHubEvent,
  WorkflowStage,
  HAUNTED_LABELS,
  parseUserCommand,
} from '../models/index.js';
import { RunnerPool } from './runner-pool.js';
import { TaskQueue } from './task-queue.js';

export interface OrchestratorStats {
  startTime: Date;
  tasksProcessed: number;
  tasksSucceeded: number;
  tasksFailed: number;
  isRunning: boolean;
  activeRunners: number;
}

export class Orchestrator extends EventEmitter {
  private config: HauntedConfig;
  private runnerPool: RunnerPool;
  private taskQueue: TaskQueue;
  private isRunning: boolean = false;
  private stats: OrchestratorStats;
  private trackedIssues: Map<string, TrackedIssue> = new Map();

  constructor(config: HauntedConfig) {
    super();
    this.config = config;
    this.runnerPool = new RunnerPool(config.runner.maxConcurrent);
    this.taskQueue = new TaskQueue();

    this.stats = {
      startTime: new Date(),
      tasksProcessed: 0,
      tasksSucceeded: 0,
      tasksFailed: 0,
      isRunning: false,
      activeRunners: 0,
    };

    this.setupEventHandlers();
  }

  /**
   * Start the orchestrator
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Orchestrator is already running');
      return;
    }

    this.isRunning = true;
    this.stats.isRunning = true;
    this.stats.startTime = new Date();

    logger.info('Haunted Orchestrator starting...');

    // Start processing loop
    this.processLoop();

    this.emit('start');
  }

  /**
   * Stop the orchestrator
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    logger.info('Stopping Haunted Orchestrator...');
    this.isRunning = false;
    this.stats.isRunning = false;

    // Wait for active runners to complete
    await this.runnerPool.waitForAll();

    this.emit('stop');
  }

  /**
   * Get current stats
   */
  getStats(): OrchestratorStats {
    return {
      ...this.stats,
      activeRunners: this.runnerPool.activeCount(),
    };
  }

  /**
   * Handle a GitHub event
   */
  async handleEvent(event: GitHubEvent): Promise<void> {
    logger.info(`Handling GitHub event: ${event.type}`);

    switch (event.type) {
      case 'issues.labeled':
        await this.handleIssueLabeled(event);
        break;

      case 'issue_comment.created':
        await this.handleIssueComment(event);
        break;

      case 'pull_request_review.submitted':
      case 'pull_request_review_comment.created':
        await this.handlePRReview(event);
        break;

      case 'pull_request.closed':
        await this.handlePRClosed(event);
        break;

      default:
        logger.debug(`Ignoring event type: ${event.type}`);
    }
  }

  /**
   * Handle issue labeled event
   */
  private async handleIssueLabeled(event: GitHubEvent): Promise<void> {
    if (!event.issue || !event.label) return;

    // Only handle our trigger label
    if (event.label.name !== this.config.github.triggerLabel) {
      return;
    }

    const issue = event.issue;
    const repo = event.repository.fullName;

    // Check if user is allowed
    const github = new GitHubService(repo);
    const isCollaborator = await github.isCollaborator(issue.author);

    if (!isCollaborator) {
      logger.warn(`User ${issue.author} is not a collaborator, ignoring issue #${issue.number}`);
      await github.addIssueComment(
        issue.number,
        '⚠️ Sorry, only repository collaborators can use Haunted.'
      );
      return;
    }

    // Create tracked issue
    const trackedIssue: TrackedIssue = {
      id: `${repo}#${issue.number}`,
      githubNumber: issue.number,
      repository: repo,
      title: issue.title,
      description: issue.body,
      author: issue.author,
      status: 'pending',
      workflowStage: WorkflowStage.PLANNING,
      branchName: `issue/${issue.number}`,
      iterationCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.trackedIssues.set(trackedIssue.id, trackedIssue);

    // Queue the task
    this.taskQueue.enqueue({
      id: `process-${trackedIssue.id}`,
      type: 'process_issue',
      repository: repo,
      issueNumber: issue.number,
      priority: 1,
      payload: { issue: trackedIssue },
      createdAt: new Date(),
    });

    logger.info(`Queued issue #${issue.number} from ${repo} for processing`);
  }

  /**
   * Handle issue comment event
   */
  private async handleIssueComment(event: GitHubEvent): Promise<void> {
    if (!event.issue || !event.comment) return;

    const command = parseUserCommand(event.comment.body);
    if (!command) return;

    const issueId = `${event.repository.fullName}#${event.issue.number}`;
    const trackedIssue = this.trackedIssues.get(issueId);

    if (!trackedIssue) {
      logger.debug(`No tracked issue found for ${issueId}`);
      return;
    }

    // Verify commenter is the issue author or a collaborator
    const github = new GitHubService(event.repository.fullName);
    const isAuthor = event.comment.author === trackedIssue.author;
    const isCollaborator = await github.isCollaborator(event.comment.author);

    if (!isAuthor && !isCollaborator) {
      logger.debug(`User ${event.comment.author} not authorized for command`);
      return;
    }

    // Queue command handling
    this.taskQueue.enqueue({
      id: `command-${issueId}-${Date.now()}`,
      type: 'handle_comment',
      repository: event.repository.fullName,
      issueNumber: event.issue.number,
      priority: 2, // Higher priority than new issues
      payload: { command, issue: trackedIssue, author: event.comment.author },
      createdAt: new Date(),
    });

    logger.info(`Queued command ${command} for issue #${event.issue.number}`);
  }

  /**
   * Handle PR review event
   */
  private async handlePRReview(event: GitHubEvent): Promise<void> {
    if (!event.pullRequest) return;

    // Find the associated issue
    const issueNumber = event.pullRequest.issueNumber;
    if (!issueNumber) return;

    const issueId = `${event.repository.fullName}#${issueNumber}`;
    const trackedIssue = this.trackedIssues.get(issueId);

    if (!trackedIssue || trackedIssue.workflowStage !== WorkflowStage.REVIEW) {
      return;
    }

    // Queue review handling
    this.taskQueue.enqueue({
      id: `review-${issueId}-${Date.now()}`,
      type: 'handle_review',
      repository: event.repository.fullName,
      issueNumber,
      priority: 2,
      payload: {
        issue: trackedIssue,
        prNumber: event.pullRequest.number,
        comment: event.reviewComment,
      },
      createdAt: new Date(),
    });

    logger.info(`Queued review handling for issue #${issueNumber}`);
  }

  /**
   * Handle PR closed/merged event
   */
  private async handlePRClosed(event: GitHubEvent): Promise<void> {
    if (!event.pullRequest) return;

    // Only handle merged PRs
    if (event.pullRequest.state !== 'merged') return;

    const issueNumber = event.pullRequest.issueNumber;
    if (!issueNumber) return;

    const issueId = `${event.repository.fullName}#${issueNumber}`;
    const trackedIssue = this.trackedIssues.get(issueId);

    if (!trackedIssue) return;

    // Process merge completion
    const workflow = new WorkflowEngine(this.config, event.repository.fullName);
    await workflow.handlePRMerged(trackedIssue);

    // Remove from tracking
    this.trackedIssues.delete(issueId);

    logger.info(`Issue #${issueNumber} completed after PR merge`);
  }

  /**
   * Main processing loop
   */
  private async processLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        // Check if we have capacity
        if (!this.runnerPool.hasCapacity()) {
          await this.sleep(1000);
          continue;
        }

        // Get next task
        const task = this.taskQueue.dequeue();
        if (!task) {
          await this.sleep(1000);
          continue;
        }

        // Process task in a runner
        this.runnerPool.execute(async (runnerId) => {
          await this.processTask(task, runnerId);
        });

      } catch (error) {
        logger.error('Error in processing loop:', error);
        await this.sleep(5000);
      }
    }
  }

  /**
   * Process a single task
   */
  private async processTask(task: QueuedTask, runnerId: string): Promise<void> {
    const startTime = Date.now();
    logger.info(`[Runner ${runnerId}] Processing task: ${task.id}`);

    try {
      const workflow = new WorkflowEngine(this.config, task.repository);
      const issue = task.payload.issue as TrackedIssue;

      switch (task.type) {
        case 'process_issue':
          issue.status = 'processing';
          await workflow.processIssue(issue);
          break;

        case 'handle_comment':
          const command = task.payload.command as string;
          const author = task.payload.author as string;
          await workflow.handleCommand(issue, command, author);
          break;

        case 'handle_review':
          const github = new GitHubService(task.repository);
          const prNumber = task.payload.prNumber as number;
          const comments = await github.getPRReviewComments(prNumber);
          await workflow.handleReviewComments(
            issue,
            comments.map(c => ({ path: '', body: c.body }))
          );
          break;
      }

      this.stats.tasksSucceeded++;
      this.emit('task-completed', { task, duration: Date.now() - startTime });

    } catch (error) {
      logger.error(`[Runner ${runnerId}] Task failed:`, error);
      this.stats.tasksFailed++;
      this.emit('task-failed', { task, error, duration: Date.now() - startTime });
    }

    this.stats.tasksProcessed++;
  }

  /**
   * Setup event handlers
   */
  private setupEventHandlers(): void {
    this.runnerPool.on('runner-idle', (runnerId) => {
      logger.debug(`Runner ${runnerId} is now idle`);
    });

    this.runnerPool.on('runner-busy', (runnerId) => {
      logger.debug(`Runner ${runnerId} is now busy`);
    });
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default Orchestrator;
export { RunnerPool } from './runner-pool.js';
export { TaskQueue } from './task-queue.js';

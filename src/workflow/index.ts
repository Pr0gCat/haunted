/**
 * Workflow Engine - Orchestrates the issue processing workflow
 *
 * Workflow Stages:
 * PLANNING → IMPLEMENTING → TESTING → REVIEW → DONE
 */

import { GitHubService } from '../services/github/index.js';
import { GitService, WorktreeManager } from '../services/git/index.js';
import { ClaudeService } from '../services/claude/index.js';
import { NotificationService } from '../services/notification/index.js';
import { logger } from '../utils/logger.js';
import {
  type TrackedIssue,
  type HauntedConfig,
  WorkflowStage,
  HAUNTED_LABELS,
  PROJECT_COLUMNS,
} from '../models/index.js';

export interface WorkflowResult {
  success: boolean;
  stage: WorkflowStage;
  message: string;
  data?: Record<string, unknown>;
}

export class WorkflowEngine {
  private github: GitHubService;
  private claude: ClaudeService;
  private worktreeManager: WorktreeManager;
  private notification: NotificationService;

  constructor(
    private config: HauntedConfig,
    private repository: string
  ) {
    this.github = new GitHubService(repository);
    this.claude = new ClaudeService();
    this.worktreeManager = new WorktreeManager(config.runner.workDir);
    this.notification = new NotificationService(this.github);
  }

  /**
   * Process an issue through its current workflow stage
   */
  async processIssue(issue: TrackedIssue): Promise<WorkflowResult> {
    logger.info(`[Workflow] Processing issue #${issue.githubNumber} at stage ${issue.workflowStage}`);

    try {
      switch (issue.workflowStage) {
        case WorkflowStage.PLANNING:
          return await this.planningStage(issue);

        case WorkflowStage.IMPLEMENTING:
          return await this.implementingStage(issue);

        case WorkflowStage.TESTING:
          return await this.testingStage(issue);

        case WorkflowStage.REVIEW:
          return await this.reviewStage(issue);

        case WorkflowStage.DONE:
          return {
            success: true,
            stage: WorkflowStage.DONE,
            message: 'Issue is already completed',
          };

        default:
          throw new Error(`Unknown workflow stage: ${issue.workflowStage}`);
      }
    } catch (error) {
      logger.error(`[Workflow] Error processing issue #${issue.githubNumber}:`, error);
      return await this.handleError(issue, error);
    }
  }

  /**
   * PLANNING Stage: Analyze requirements and create implementation plan
   */
  private async planningStage(issue: TrackedIssue): Promise<WorkflowResult> {
    logger.info(`[Workflow] PLANNING stage for issue #${issue.githubNumber}`);

    // Update labels and project
    await this.github.updateStageLabel(issue.githubNumber, HAUNTED_LABELS.PLANNING);

    // Create worktree for this issue
    const worktree = await this.worktreeManager.createWorktree(
      issue.repository,
      issue.githubNumber
    );
    issue.worktreePath = worktree.path;

    // Notify that processing has started
    await this.notification.notifyProcessingStarted(issue);

    // Generate plan using Claude
    const plan = await this.claude.analyzeAndPlan(issue, worktree.path);

    if (!plan) {
      return await this.handleError(issue, new Error('Failed to generate plan'));
    }

    // Format plan for display
    const planText = this.formatPlan(plan);
    issue.plan = planText;

    // Notify that plan is ready
    await this.notification.notifyPlanReady(issue, planText);

    // Update issue status to waiting for approval
    issue.status = 'waiting_approval';

    return {
      success: true,
      stage: WorkflowStage.PLANNING,
      message: 'Plan created, waiting for approval',
      data: { plan },
    };
  }

  /**
   * IMPLEMENTING Stage: Execute the planned implementation
   */
  private async implementingStage(issue: TrackedIssue): Promise<WorkflowResult> {
    logger.info(`[Workflow] IMPLEMENTING stage for issue #${issue.githubNumber}`);

    // Update labels
    await this.github.updateStageLabel(issue.githubNumber, HAUNTED_LABELS.IMPLEMENTING);

    // Ensure worktree exists
    const worktree = await this.worktreeManager.getWorktree(
      issue.repository,
      issue.githubNumber
    ) || await this.worktreeManager.createWorktree(issue.repository, issue.githubNumber);

    // Notify implementation started
    await this.notification.notifyImplementationStarted(issue);

    // Implement the solution
    const result = await this.claude.implement(
      issue,
      issue.plan || issue.description,
      worktree.path
    );

    if (!result.success) {
      return await this.handleError(issue, new Error(result.error || 'Implementation failed'));
    }

    // Commit changes
    const git = new GitService(worktree.path);
    await git.commit(`feat: implement #${issue.githubNumber} - ${issue.title}`, true);
    await git.push();

    // Move to testing stage
    issue.workflowStage = WorkflowStage.TESTING;

    return {
      success: true,
      stage: WorkflowStage.TESTING,
      message: 'Implementation complete, moving to testing',
      data: { filesChanged: result.filesChanged },
    };
  }

  /**
   * TESTING Stage: Run tests and fix failures
   */
  private async testingStage(issue: TrackedIssue): Promise<WorkflowResult> {
    logger.info(`[Workflow] TESTING stage for issue #${issue.githubNumber}`);

    // Update labels
    await this.github.updateStageLabel(issue.githubNumber, HAUNTED_LABELS.TESTING);

    // Get worktree
    const worktree = await this.worktreeManager.getWorktree(
      issue.repository,
      issue.githubNumber
    );

    if (!worktree) {
      return await this.handleError(issue, new Error('Worktree not found'));
    }

    // Notify testing started
    await this.notification.notifyTestingStarted(issue);

    // Determine test command
    const testCommands = this.config.workflow.testCommands || [
      'npm test',
      'yarn test',
      'bun test',
    ];

    let testPassed = false;
    let testOutput = '';

    for (const command of testCommands) {
      const result = await this.claude.runTestsAndFix(
        command,
        worktree.path,
        this.config.workflow.maxRetries
      );

      if (result.success) {
        testPassed = true;
        testOutput = result.output;
        break;
      }
    }

    if (!testPassed) {
      // Check iteration count
      issue.iterationCount++;
      if (issue.iterationCount >= this.config.workflow.maxRetries) {
        return await this.handleError(issue, new Error('Tests failed after maximum retries'));
      }

      // Go back to implementing
      issue.workflowStage = WorkflowStage.IMPLEMENTING;
      return {
        success: false,
        stage: WorkflowStage.IMPLEMENTING,
        message: `Tests failed, retrying (attempt ${issue.iterationCount})`,
      };
    }

    // Push any fixes
    const git = new GitService(worktree.path);
    const committed = await git.commit(`fix: test fixes for #${issue.githubNumber}`, true);
    if (committed) {
      await git.push();
    }

    // Move to review stage
    issue.workflowStage = WorkflowStage.REVIEW;

    return {
      success: true,
      stage: WorkflowStage.REVIEW,
      message: 'Tests passed, creating PR',
      data: { testOutput },
    };
  }

  /**
   * REVIEW Stage: Create PR and wait for review
   */
  private async reviewStage(issue: TrackedIssue): Promise<WorkflowResult> {
    logger.info(`[Workflow] REVIEW stage for issue #${issue.githubNumber}`);

    // Update labels
    await this.github.updateStageLabel(issue.githubNumber, HAUNTED_LABELS.REVIEW);

    // Get worktree to check for changes
    const worktree = await this.worktreeManager.getWorktree(
      issue.repository,
      issue.githubNumber
    );

    if (!worktree) {
      return await this.handleError(issue, new Error('Worktree not found'));
    }

    // Create PR if not already created
    if (!issue.prNumber) {
      const git = new GitService(worktree.path);
      const defaultBranch = await git.getDefaultBranch();
      const changedFiles = await git.getChangedFiles(defaultBranch);

      const pr = await this.github.createPullRequest({
        title: `feat: ${issue.title}`,
        body: this.formatPRBody(issue, changedFiles),
        head: issue.branchName,
        base: defaultBranch,
      });

      issue.prNumber = pr.number;

      // Notify PR is ready
      await this.notification.notifyPRReady(issue, pr.number, pr.url);
    }

    // Set status to waiting for review
    issue.status = 'waiting_approval';

    return {
      success: true,
      stage: WorkflowStage.REVIEW,
      message: 'PR created, waiting for review',
      data: { prNumber: issue.prNumber },
    };
  }

  /**
   * Handle PR review comments
   */
  async handleReviewComments(issue: TrackedIssue, comments: Array<{ path: string; body: string; line?: number }>): Promise<WorkflowResult> {
    logger.info(`[Workflow] Handling ${comments.length} review comments for issue #${issue.githubNumber}`);

    if (!issue.prNumber) {
      return {
        success: false,
        stage: issue.workflowStage,
        message: 'No PR found for this issue',
      };
    }

    const worktree = await this.worktreeManager.getWorktree(
      issue.repository,
      issue.githubNumber
    );

    if (!worktree) {
      return await this.handleError(issue, new Error('Worktree not found'));
    }

    // Notify addressing review
    await this.notification.notifyAddressingReview(issue.prNumber, comments.length);

    // Address comments
    const result = await this.claude.handleReviewComments(comments, worktree.path);

    if (!result.addressed) {
      return {
        success: false,
        stage: WorkflowStage.REVIEW,
        message: 'Failed to address review comments',
      };
    }

    // Commit and push
    const git = new GitService(worktree.path);
    const committed = await git.commit(`fix: address review comments for #${issue.githubNumber}`, true);
    if (committed) {
      await git.push();
    }

    // Notify review addressed
    await this.notification.notifyReviewAddressed(issue.prNumber, result.changes);

    return {
      success: true,
      stage: WorkflowStage.REVIEW,
      message: 'Review comments addressed',
      data: { changes: result.changes },
    };
  }

  /**
   * Handle PR merge (complete the workflow)
   */
  async handlePRMerged(issue: TrackedIssue): Promise<WorkflowResult> {
    logger.info(`[Workflow] PR merged for issue #${issue.githubNumber}`);

    // Update to DONE stage
    issue.workflowStage = WorkflowStage.DONE;
    issue.status = 'completed';

    // Remove all haunted labels except completion
    try {
      const stageLabels = Object.values(HAUNTED_LABELS);
      await this.github.removeIssueLabels(issue.githubNumber, stageLabels);
    } catch {
      // Ignore label removal errors
    }

    // Close the issue
    await this.github.closeIssue(issue.githubNumber, 'completed');

    // Notify completion
    await this.notification.notifyComplete(issue, issue.prNumber!);

    // Clean up worktree
    await this.worktreeManager.removeWorktree(issue.repository, issue.githubNumber);

    return {
      success: true,
      stage: WorkflowStage.DONE,
      message: 'Issue completed successfully',
    };
  }

  /**
   * Handle user commands
   */
  async handleCommand(issue: TrackedIssue, command: string, author: string): Promise<WorkflowResult> {
    logger.info(`[Workflow] Handling command ${command} from ${author} for issue #${issue.githubNumber}`);

    switch (command) {
      case '/approve':
        if (issue.workflowStage === WorkflowStage.PLANNING) {
          issue.workflowStage = WorkflowStage.IMPLEMENTING;
          issue.status = 'processing';
          return this.processIssue(issue);
        }
        break;

      case '/reject':
        if (issue.workflowStage === WorkflowStage.PLANNING) {
          await this.notification.notifyPlanRejected(issue);
          issue.iterationCount++;
          return this.processIssue(issue);
        }
        break;

      case '/pause':
        issue.status = 'waiting_approval';
        await this.notification.notifyPaused(issue);
        return {
          success: true,
          stage: issue.workflowStage,
          message: 'Processing paused',
        };

      case '/retry':
        issue.status = 'processing';
        return this.processIssue(issue);

      case '/status':
        await this.notification.notifyStatus(issue);
        return {
          success: true,
          stage: issue.workflowStage,
          message: 'Status reported',
        };
    }

    return {
      success: false,
      stage: issue.workflowStage,
      message: `Unknown or invalid command: ${command}`,
    };
  }

  /**
   * Handle errors
   */
  private async handleError(issue: TrackedIssue, error: unknown): Promise<WorkflowResult> {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`[Workflow] Error for issue #${issue.githubNumber}: ${errorMessage}`);

    issue.status = 'blocked';
    issue.errorLog = errorMessage;

    // Add blocked label
    await this.github.updateStageLabel(issue.githubNumber, HAUNTED_LABELS.BLOCKED);

    // Notify user
    await this.notification.notifyBlocked(issue, errorMessage);

    return {
      success: false,
      stage: issue.workflowStage,
      message: errorMessage,
    };
  }

  /**
   * Format plan for display
   */
  private formatPlan(plan: { analysis: string; plan: { steps: Array<{ id: number; title: string }> } }): string {
    const steps = plan.plan.steps
      .map(s => `${s.id}. ${s.title}`)
      .join('\n');

    return `
### Analysis
${plan.analysis}

### Implementation Steps
${steps}
`.trim();
  }

  /**
   * Format PR body
   */
  private formatPRBody(issue: TrackedIssue, changedFiles: string[]): string {
    const fileList = changedFiles.length > 0
      ? changedFiles.map(f => `- \`${f}\``).join('\n')
      : '- No files listed';

    return `
## Summary

Closes #${issue.githubNumber}

${issue.description}

## Changes

${fileList}

## Test Plan

- [x] Automated tests pass
- [ ] Manual testing (if applicable)

---
*This PR was automatically generated by Haunted* 👻
`.trim();
  }
}

export default WorkflowEngine;

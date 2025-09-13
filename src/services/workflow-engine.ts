/**
 * Workflow Engine - Manages the automated workflow for processing issues
 */

import { type Issue, WorkflowStage } from '../models/index.js';
import { DatabaseManager } from './database.js';
import { GitManager } from './git-manager.js';
import { ClaudeCodeWrapper } from './claude-wrapper.js';
import { logger } from '../utils/logger.js';

export class WorkflowEngine {
  constructor(
    private db: DatabaseManager,
    private git: GitManager,
    private claude: ClaudeCodeWrapper
  ) {}

  async processIssue(issue: Issue): Promise<any> {
    logger.info(`Processing issue ${issue.id}: ${issue.title}`);

    try {
      switch (issue.workflowStage) {
        case 'pending':
          return await this.startAnalysis(issue);

        case 'analyzing':
          return await this.generatePlan(issue);

        case 'planning':
          return await this.startImplementation(issue);

        case 'implementing':
          return await this.runTests(issue);

        case 'testing':
          return await this.reviewChanges(issue);

        case 'reviewing':
          return await this.completeIssue(issue);

        case 'completed':
          logger.info(`Issue ${issue.id} is already completed`);
          return { status: 'completed', message: 'Issue is already completed' };

        case 'failed':
          return await this.retryIssue(issue);

        default:
          throw new Error(`Unknown workflow stage: ${issue.workflowStage}`);
      }
    } catch (error) {
      logger.error(`Workflow processing failed for issue ${issue.id}:`, error);
      await this.handleFailure(issue, error);
      throw error;
    }
  }

  private async startAnalysis(issue: Issue): Promise<any> {
    logger.info(`Starting analysis for issue ${issue.id}`);

    await this.updateWorkflowStage(issue.id, WorkflowStage.ANALYZING);

    try {
      // Switch to issue branch
      await this.git.switchToBranch(issue.branchName);

      // Analyze the issue
      const analysis = await this.claude.analyzeAndPlan(issue);

      if (analysis.error) {
        throw new Error(`Analysis failed: ${analysis.error}`);
      }

      // Save analysis results
      await this.db.updateIssuePlan(issue.id, JSON.stringify(analysis, null, 2));

      // Move to planning stage
      await this.updateWorkflowStage(issue.id, WorkflowStage.PLANNING);

      logger.info(`Analysis completed for issue ${issue.id}`);

      return {
        status: 'analysis_complete',
        stage: WorkflowStage.PLANNING,
        analysis
      };

    } catch (error) {
      await this.handleFailure(issue, error);
      throw error;
    }
  }

  private async generatePlan(issue: Issue): Promise<any> {
    logger.info(`Generating implementation plan for issue ${issue.id}`);

    try {
      // If we already have a plan, move to implementation
      if (issue.plan) {
        await this.updateWorkflowStage(issue.id, WorkflowStage.IMPLEMENTING);
        return { status: 'plan_ready', stage: WorkflowStage.IMPLEMENTING };
      }

      // Generate plan using Claude
      const plan = await this.claude.analyzeAndPlan(issue);

      if (plan.error) {
        throw new Error(`Plan generation failed: ${plan.error}`);
      }

      // Save the plan
      await this.db.updateIssuePlan(issue.id, JSON.stringify(plan, null, 2));

      // Move to implementation stage
      await this.updateWorkflowStage(issue.id, WorkflowStage.IMPLEMENTING);

      logger.info(`Plan generated for issue ${issue.id}`);

      return {
        status: 'plan_generated',
        stage: WorkflowStage.IMPLEMENTING,
        plan
      };

    } catch (error) {
      await this.handleFailure(issue, error);
      throw error;
    }
  }

  private async startImplementation(issue: Issue): Promise<any> {
    logger.info(`Starting implementation for issue ${issue.id}`);

    try {
      // Ensure we're on the correct branch
      await this.git.switchToBranch(issue.branchName);

      // Generate implementation using Claude
      const implementation = await this.claude.implementSolution(issue);

      if (implementation.error) {
        throw new Error(`Implementation failed: ${implementation.error}`);
      }

      // Execute implementation steps
      const results = await this.executeImplementation(implementation);

      // Move to testing stage
      await this.updateWorkflowStage(issue.id, WorkflowStage.TESTING);

      logger.info(`Implementation completed for issue ${issue.id}`);

      return {
        status: 'implementation_complete',
        stage: WorkflowStage.TESTING,
        implementation,
        results
      };

    } catch (error) {
      await this.handleFailure(issue, error);
      throw error;
    }
  }

  private async executeImplementation(implementation: any): Promise<any> {
    const results: any = {
      filesCreated: [],
      filesModified: [],
      commandsExecuted: [],
      errors: []
    };

    // Handle file operations
    if (implementation.implementation?.files) {
      for (const file of implementation.implementation.files) {
        try {
          await this.handleFileOperation(file);

          if (file.action === 'create') {
            results.filesCreated.push(file.path);
          } else if (file.action === 'modify') {
            results.filesModified.push(file.path);
          }
        } catch (error) {
          logger.error(`File operation failed for ${file.path}:`, error);
          results.errors.push(`File operation failed: ${file.path} - ${error}`);
        }
      }
    }

    // Handle command execution
    if (implementation.implementation?.commands) {
      for (const command of implementation.implementation.commands) {
        try {
          const result = await this.claude.executeDiagnosticCommand(command.command);
          results.commandsExecuted.push({
            command: command.command,
            success: result.success,
            output: result.stdout,
            error: result.stderr
          });

          if (!result.success) {
            results.errors.push(`Command failed: ${command.command} - ${result.stderr}`);
          }
        } catch (error) {
          logger.error(`Command execution failed:`, error);
          results.errors.push(`Command execution failed: ${command.command} - ${error}`);
        }
      }
    }

    return results;
  }

  private async handleFileOperation(file: any): Promise<void> {
    const fs = await import('fs/promises');
    const path = await import('path');

    const fullPath = path.resolve(file.path);

    switch (file.action) {
      case 'create':
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, file.content, 'utf8');
        break;

      case 'modify':
        await fs.writeFile(fullPath, file.content, 'utf8');
        break;

      case 'delete':
        await fs.unlink(fullPath);
        break;

      default:
        throw new Error(`Unknown file action: ${file.action}`);
    }
  }

  private async runTests(issue: Issue): Promise<any> {
    logger.info(`Running tests for issue ${issue.id}`);

    try {
      // Check for common test commands
      const testCommands = ['npm test', 'npm run test', 'yarn test', 'bun test'];
      let testResult = null;

      for (const command of testCommands) {
        try {
          const result = await this.claude.executeDiagnosticCommand(command);
          if (result.success) {
            testResult = result;
            break;
          }
        } catch (error) {
          // Continue to next test command
          continue;
        }
      }

      // Move to review stage
      await this.updateWorkflowStage(issue.id, WorkflowStage.REVIEWING);

      logger.info(`Tests completed for issue ${issue.id}`);

      return {
        status: 'tests_complete',
        stage: WorkflowStage.REVIEWING,
        testResult
      };

    } catch (error) {
      await this.handleFailure(issue, error);
      throw error;
    }
  }

  private async reviewChanges(issue: Issue): Promise<any> {
    logger.info(`Reviewing changes for issue ${issue.id}`);

    try {
      // Get the changes made
      const diff = await this.git.getDiff();
      const status = await this.git.getRepositoryStatus();

      // Check if we have changes to commit
      if (status.isDirty) {
        // Commit the changes
        await this.git.commitChanges(`Implement solution for issue: ${issue.title}`);
      }

      // Move to completed stage
      await this.updateWorkflowStage(issue.id, WorkflowStage.COMPLETED);
      await this.db.updateIssueStatus(issue.id, 'closed');

      logger.info(`Review completed for issue ${issue.id}`);

      return {
        status: 'review_complete',
        stage: WorkflowStage.COMPLETED,
        diff,
        changes: status
      };

    } catch (error) {
      await this.handleFailure(issue, error);
      throw error;
    }
  }

  private async completeIssue(issue: Issue): Promise<any> {
    logger.info(`Completing issue ${issue.id}`);

    try {
      // Ensure issue is marked as closed
      await this.db.updateIssueStatus(issue.id, 'closed');

      // Add completion comment
      await this.db.addComment(
        issue.id,
        'ai',
        'Issue has been successfully processed and completed by the workflow engine.'
      );

      return {
        status: 'completed',
        message: 'Issue processing completed successfully'
      };

    } catch (error) {
      logger.error(`Failed to complete issue ${issue.id}:`, error);
      throw error;
    }
  }

  private async retryIssue(issue: Issue): Promise<any> {
    logger.info(`Retrying failed issue ${issue.id}`);

    try {
      // Reset to pending stage for retry
      await this.updateWorkflowStage(issue.id, WorkflowStage.PENDING);
      await this.db.updateIssueStatus(issue.id, 'open');

      // Add retry comment
      await this.db.addComment(
        issue.id,
        'ai',
        'Issue is being retried after failure.'
      );

      // Start processing again
      return await this.startAnalysis(issue);

    } catch (error) {
      logger.error(`Failed to retry issue ${issue.id}:`, error);
      throw error;
    }
  }

  private async handleFailure(issue: Issue, error: any): Promise<void> {
    logger.error(`Workflow failed for issue ${issue.id}:`, error);

    try {
      await this.updateWorkflowStage(issue.id, WorkflowStage.FAILED);
      await this.db.updateIssueStatus(issue.id, 'blocked');

      // Add failure comment
      await this.db.addComment(
        issue.id,
        'ai',
        `Workflow processing failed: ${error.message || error}`
      );

    } catch (dbError) {
      logger.error(`Failed to record failure for issue ${issue.id}:`, dbError);
    }
  }

  private async updateWorkflowStage(issueId: string, stage: WorkflowStage): Promise<void> {
    try {
      await this.db.updateIssueWorkflowStage(issueId, stage);
      logger.info(`Updated issue ${issueId} workflow stage to ${stage}`);
    } catch (error) {
      logger.error(`Failed to update workflow stage for issue ${issueId}:`, error);
      throw error;
    }
  }
}
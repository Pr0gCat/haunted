/**
 * Workflow Engine - Implements the development workflow from DEVELOPMENT_WORKFLOW.md
 *
 * Workflow Stages:
 * PLAN → IMPLEMENT → UNIT_TEST → FIX_ISSUES → INTEGRATION_TEST → DIAGNOSE → DONE
 *
 * With iteration logic: DIAGNOSE can loop back to PLAN with accumulated knowledge
 */

import { type Issue, WorkflowStage } from '../models/index.js';
import { DatabaseManager } from './database.js';
import { GitManager } from './git-manager.js';
import { ClaudeCodeWrapper } from './claude-wrapper.js';
import { logger } from '../utils/logger.js';

export class WorkflowEngine {
  private readonly maxIterations = 3;

  constructor(
    private db: DatabaseManager,
    private git: GitManager,
    private claude: ClaudeCodeWrapper
  ) {}

  async processIssue(issue: Issue): Promise<any> {
    const startTime = new Date();
    logger.info(`[WorkflowEngine] Processing issue ${issue.id}: ${issue.title} at stage '${issue.workflowStage}' (iteration ${issue.iterationCount})`);

    // Check if we've exceeded max iterations
    if (issue.iterationCount >= this.maxIterations) {
      logger.warning(`[WorkflowEngine] Issue ${issue.id} reached max iterations (${this.maxIterations})`);
      await this.updateWorkflowStage(issue.id, WorkflowStage.DONE);
      await this.db.updateIssueStatus(issue.id, 'blocked');
      return {
        status: 'max_iterations_reached',
        stage: WorkflowStage.DONE,
        message: `Reached maximum iterations (${this.maxIterations})`
      };
    }

    try {
      let result;

      switch (issue.workflowStage) {
        case WorkflowStage.PLAN:
          logger.debug(`[WorkflowEngine] Starting PLAN stage for issue ${issue.id}`);
          result = await this.planStage(issue);
          break;

        case WorkflowStage.IMPLEMENT:
          logger.debug(`[WorkflowEngine] Starting IMPLEMENT stage for issue ${issue.id}`);
          result = await this.implementStage(issue);
          break;

        case WorkflowStage.UNIT_TEST:
          logger.debug(`[WorkflowEngine] Starting UNIT_TEST stage for issue ${issue.id}`);
          result = await this.unitTestStage(issue);
          break;

        case WorkflowStage.FIX_ISSUES:
          logger.debug(`[WorkflowEngine] Starting FIX_ISSUES stage for issue ${issue.id}`);
          result = await this.fixIssuesStage(issue);
          break;

        case WorkflowStage.INTEGRATION_TEST:
          logger.debug(`[WorkflowEngine] Starting INTEGRATION_TEST stage for issue ${issue.id}`);
          result = await this.integrationTestStage(issue);
          break;

        case WorkflowStage.DIAGNOSE:
          logger.debug(`[WorkflowEngine] Starting DIAGNOSE stage for issue ${issue.id}`);
          result = await this.diagnoseStage(issue);
          break;

        case WorkflowStage.DONE:
          logger.info(`[WorkflowEngine] Issue ${issue.id} is already in DONE stage - skipping`);
          result = { status: 'completed', stage: WorkflowStage.DONE, message: 'Issue is already completed' };
          break;

        default:
          throw new Error(`Unknown workflow stage: ${issue.workflowStage}`);
      }

      const processingTime = new Date().getTime() - startTime.getTime();
      logger.info(`[WorkflowEngine] Completed processing issue ${issue.id} in ${processingTime}ms - Result: ${result.status}`);

      return result;
    } catch (error) {
      const processingTime = new Date().getTime() - startTime.getTime();
      logger.error(`[WorkflowEngine] Processing failed for issue ${issue.id} after ${processingTime}ms:`, error);
      await this.handleFailure(issue, error);
      throw error;
    }
  }

  /**
   * PLAN Stage: Analyze requirements and create implementation plan
   */
  private async planStage(issue: Issue): Promise<any> {
    logger.info(`[WorkflowEngine] PLAN: Analyzing requirements for issue ${issue.id}`);

    try {
      // Switch to issue branch
      logger.debug(`[WorkflowEngine] Switching to branch '${issue.branchName}' for issue ${issue.id}`);
      await this.git.switchToBranch(issue.branchName);

      // Include previous diagnosis in planning if available
      const planningContext = issue.diagnosisLog
        ? `Previous diagnosis from iteration ${issue.iterationCount}: ${issue.diagnosisLog}\n\n`
        : '';

      // Analyze the issue and create plan
      logger.debug(`[WorkflowEngine] Starting analysis and planning for issue ${issue.id}`);
      const planResult = await this.claude.analyzeAndPlan({
        ...issue,
        description: planningContext + issue.description
      });

      if (planResult.error) {
        throw new Error(`Planning failed: ${planResult.error}`);
      }

      logger.debug(`[WorkflowEngine] Planning successful, saving plan for issue ${issue.id}`);
      // Save planning results
      await this.db.updateIssuePlan(issue.id, JSON.stringify(planResult, null, 2));

      // Move to implement stage
      logger.debug(`[WorkflowEngine] Moving issue ${issue.id} to IMPLEMENT stage`);
      await this.updateWorkflowStage(issue.id, WorkflowStage.IMPLEMENT);

      logger.info(`[WorkflowEngine] PLAN completed for issue ${issue.id}`);

      return {
        status: 'plan_complete',
        stage: WorkflowStage.IMPLEMENT,
        plan: planResult
      };

    } catch (error) {
      logger.error(`[WorkflowEngine] PLAN failed for issue ${issue.id}:`, error);
      await this.handleFailure(issue, error);
      throw error;
    }
  }

  /**
   * IMPLEMENT Stage: Execute the planned implementation
   */
  private async implementStage(issue: Issue): Promise<any> {
    logger.info(`[WorkflowEngine] IMPLEMENT: Starting implementation for issue ${issue.id}`);

    try {
      // Ensure we're on the correct branch
      await this.git.switchToBranch(issue.branchName);

      // Generate implementation using Claude based on the plan
      logger.debug(`[WorkflowEngine] Starting implementation for issue ${issue.id}`);
      const implementation = await this.claude.implementSolution(issue);

      if (implementation.error) {
        throw new Error(`Implementation failed: ${implementation.error}`);
      }

      // Execute implementation steps
      logger.debug(`[WorkflowEngine] Executing implementation steps for issue ${issue.id}`);
      const results = await this.executeImplementation(implementation);

      // Save implementation results
      const implementationData = JSON.stringify({ implementation, results }, null, 2);
      await this.db.updateIssueImplementation(issue.id, implementationData);

      // Move to unit test stage
      logger.debug(`[WorkflowEngine] Moving issue ${issue.id} to UNIT_TEST stage`);
      await this.updateWorkflowStage(issue.id, WorkflowStage.UNIT_TEST);

      logger.info(`[WorkflowEngine] IMPLEMENT completed for issue ${issue.id}`);

      return {
        status: 'implementation_complete',
        stage: WorkflowStage.UNIT_TEST,
        implementation,
        results
      };

    } catch (error) {
      logger.error(`[WorkflowEngine] IMPLEMENT failed for issue ${issue.id}:`, error);
      await this.handleFailure(issue, error);
      throw error;
    }
  }

  /**
   * UNIT_TEST Stage: Write and run unit tests for the implementation
   */
  private async unitTestStage(issue: Issue): Promise<any> {
    logger.info(`[WorkflowEngine] UNIT_TEST: Running unit tests for issue ${issue.id}`);

    try {
      // Try to run unit tests using common unit test commands
      const unitTestCommands = [
        'npm run test:unit',
        'npm test -- --testPathPattern=unit',
        'bun test unit',
        'yarn test:unit'
      ];

      let testResult = null;
      let testsPassed = false;

      logger.debug(`[WorkflowEngine] Attempting to run unit tests for issue ${issue.id}`);

      for (const command of unitTestCommands) {
        try {
          logger.debug(`[WorkflowEngine] Trying unit test command: ${command} for issue ${issue.id}`);
          const result = await this.claude.executeDiagnosticCommand(command);
          testResult = result;
          testsPassed = result.success;

          if (result.success) {
            logger.debug(`[WorkflowEngine] Unit test command '${command}' succeeded for issue ${issue.id}`);
            break;
          } else {
            logger.debug(`[WorkflowEngine] Unit test command '${command}' failed for issue ${issue.id}: ${result.stderr}`);
          }
        } catch (error) {
          logger.debug(`[WorkflowEngine] Unit test command '${command}' threw error for issue ${issue.id}: ${error}`);
          continue;
        }
      }

      // If no specific unit test commands worked, try general test commands
      if (!testResult) {
        const generalTestCommands = ['npm test', 'bun test', 'yarn test'];
        for (const command of generalTestCommands) {
          try {
            logger.debug(`[WorkflowEngine] Trying general test command: ${command} for issue ${issue.id}`);
            const result = await this.claude.executeDiagnosticCommand(command);
            testResult = result;
            testsPassed = result.success;
            if (result.success) {
              logger.debug(`[WorkflowEngine] General test command '${command}' succeeded for issue ${issue.id}`);
              break;
            }
          } catch (error) {
            continue;
          }
        }
      }

      const nextStage = testsPassed ? WorkflowStage.INTEGRATION_TEST : WorkflowStage.FIX_ISSUES;

      logger.debug(`[WorkflowEngine] Moving issue ${issue.id} to ${nextStage} stage`);
      await this.updateWorkflowStage(issue.id, nextStage);

      logger.info(`[WorkflowEngine] UNIT_TEST completed for issue ${issue.id} (passed: ${testsPassed})`);

      return {
        status: 'unit_tests_complete',
        stage: nextStage,
        testsPassed,
        testResult
      };

    } catch (error) {
      logger.error(`[WorkflowEngine] UNIT_TEST failed for issue ${issue.id}:`, error);
      await this.updateWorkflowStage(issue.id, WorkflowStage.FIX_ISSUES);
      return {
        status: 'unit_tests_failed',
        stage: WorkflowStage.FIX_ISSUES,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * FIX_ISSUES Stage: Fix failing unit tests
   */
  private async fixIssuesStage(issue: Issue): Promise<any> {
    logger.info(`[WorkflowEngine] FIX_ISSUES: Fixing unit test failures for issue ${issue.id}`);

    try {
      // Use Claude to analyze test failures and generate fixes
      const fixResult = await this.claude.diagnoseIssue(issue);

      if (fixResult.error) {
        throw new Error(`Issue diagnosis failed: ${fixResult.error}`);
      }

      // Execute any suggested fixes
      if (fixResult.recommendations) {
        for (const recommendation of fixResult.recommendations) {
          if (recommendation.solution && recommendation.priority === 'high') {
            logger.debug(`[WorkflowEngine] Applying fix: ${recommendation.solution}`);
            // This would need more sophisticated implementation to actually apply fixes
            // For now, we'll just log the recommendations
          }
        }
      }

      // Move back to unit test stage to verify fixes
      logger.debug(`[WorkflowEngine] Moving issue ${issue.id} back to UNIT_TEST stage`);
      await this.updateWorkflowStage(issue.id, WorkflowStage.UNIT_TEST);

      logger.info(`[WorkflowEngine] FIX_ISSUES completed for issue ${issue.id}`);

      return {
        status: 'issues_fixed',
        stage: WorkflowStage.UNIT_TEST,
        fixes: fixResult
      };

    } catch (error) {
      logger.error(`[WorkflowEngine] FIX_ISSUES failed for issue ${issue.id}:`, error);
      await this.handleFailure(issue, error);
      throw error;
    }
  }

  /**
   * INTEGRATION_TEST Stage: Run integration tests to verify system integration
   */
  private async integrationTestStage(issue: Issue): Promise<any> {
    logger.info(`[WorkflowEngine] INTEGRATION_TEST: Running integration tests for issue ${issue.id}`);

    try {
      // Try to run integration tests using common integration test commands
      const integrationTestCommands = [
        'npm run test:integration',
        'npm test -- --testPathPattern=integration',
        'bun test integration',
        'yarn test:integration',
        'npm run test:e2e',
        'npm test -- --testPathPattern=e2e'
      ];

      let testResult = null;
      let testsPassed = false;

      logger.debug(`[WorkflowEngine] Attempting to run integration tests for issue ${issue.id}`);

      for (const command of integrationTestCommands) {
        try {
          logger.debug(`[WorkflowEngine] Trying integration test command: ${command} for issue ${issue.id}`);
          const result = await this.claude.executeDiagnosticCommand(command);
          testResult = result;
          testsPassed = result.success;

          if (result.success) {
            logger.debug(`[WorkflowEngine] Integration test command '${command}' succeeded for issue ${issue.id}`);
            break;
          } else {
            logger.debug(`[WorkflowEngine] Integration test command '${command}' failed for issue ${issue.id}: ${result.stderr}`);
          }
        } catch (error) {
          logger.debug(`[WorkflowEngine] Integration test command '${command}' threw error for issue ${issue.id}: ${error}`);
          continue;
        }
      }

      const nextStage = testsPassed ? WorkflowStage.DONE : WorkflowStage.DIAGNOSE;

      logger.debug(`[WorkflowEngine] Moving issue ${issue.id} to ${nextStage} stage`);
      await this.updateWorkflowStage(issue.id, nextStage);

      if (nextStage === WorkflowStage.DONE) {
        // Mark issue as closed when successfully completed
        await this.db.updateIssueStatus(issue.id, 'closed');
        await this.db.addComment(
          issue.id,
          'ai',
          'Issue has been successfully completed. All unit and integration tests pass.'
        );
      }

      logger.info(`[WorkflowEngine] INTEGRATION_TEST completed for issue ${issue.id} (passed: ${testsPassed})`);

      return {
        status: 'integration_tests_complete',
        stage: nextStage,
        testsPassed,
        testResult
      };

    } catch (error) {
      logger.error(`[WorkflowEngine] INTEGRATION_TEST failed for issue ${issue.id}:`, error);
      await this.updateWorkflowStage(issue.id, WorkflowStage.DIAGNOSE);
      return {
        status: 'integration_tests_failed',
        stage: WorkflowStage.DIAGNOSE,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * DIAGNOSE Stage: Document failures and analyze root causes
   */
  private async diagnoseStage(issue: Issue): Promise<any> {
    logger.info(`[WorkflowEngine] DIAGNOSE: Analyzing failures for issue ${issue.id}`);

    try {
      // Use Claude to perform comprehensive diagnosis
      const diagnosis = await this.claude.diagnoseIssue(issue);

      if (diagnosis.error) {
        throw new Error(`Diagnosis failed: ${diagnosis.error}`);
      }

      // Save diagnosis log
      const diagnosisLog = JSON.stringify(diagnosis, null, 2);
      await this.db.updateIssueDiagnosisLog(issue.id, diagnosisLog);

      // Increment iteration count
      const newIterationCount = await this.db.incrementIssueIteration(issue.id);

      logger.debug(`[WorkflowEngine] Diagnosis complete, starting iteration ${newIterationCount} for issue ${issue.id}`);

      // Add diagnosis comment
      await this.db.addComment(
        issue.id,
        'ai',
        `Iteration ${newIterationCount} diagnosis complete. Root causes identified: ${diagnosis.diagnosis?.rootCauses?.map((rc: any) => rc.cause).join(', ') || 'Analysis in progress'}`
      );

      // Move back to PLAN stage with accumulated knowledge
      logger.debug(`[WorkflowEngine] Moving issue ${issue.id} back to PLAN stage for iteration ${newIterationCount}`);
      await this.updateWorkflowStage(issue.id, WorkflowStage.PLAN);

      logger.info(`[WorkflowEngine] DIAGNOSE completed for issue ${issue.id}, starting iteration ${newIterationCount}`);

      return {
        status: 'diagnosis_complete',
        stage: WorkflowStage.PLAN,
        iteration: newIterationCount,
        diagnosis
      };

    } catch (error) {
      logger.error(`[WorkflowEngine] DIAGNOSE failed for issue ${issue.id}:`, error);
      await this.handleFailure(issue, error);
      throw error;
    }
  }

  /**
   * Execute implementation steps (file operations, commands)
   */
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

  /**
   * Handle individual file operations
   */
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

  /**
   * Handle workflow failures
   */
  private async handleFailure(issue: Issue, error: any): Promise<void> {
    logger.error(`Workflow failed for issue ${issue.id}:`, error);

    try {
      await this.updateWorkflowStage(issue.id, WorkflowStage.DONE);
      await this.db.updateIssueStatus(issue.id, 'blocked');

      // Add failure comment
      await this.db.addComment(
        issue.id,
        'ai',
        `Workflow processing failed at stage ${issue.workflowStage}: ${error.message || error}`
      );

    } catch (dbError) {
      logger.error(`Failed to record failure for issue ${issue.id}:`, dbError);
    }
  }

  /**
   * Update workflow stage
   */
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
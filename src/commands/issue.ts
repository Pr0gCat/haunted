/**
 * Issue commands - Manage issues
 */

import chalk from 'chalk';
import ora from 'ora';
import { ConfigManager } from '../utils/config.js';
import { DatabaseManager } from '../services/database.js';
import { GitManager } from '../services/git-manager.js';
import { logger } from '../utils/logger.js';

interface CreateOptions {
  description?: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  phase?: string;
}

interface ListOptions {
  status?: string;
  stage?: string;
}

export const issueCommands = {
  async create(title: string, options: CreateOptions): Promise<void> {
    const spinner = ora('Creating issue...').start();

    try {
      const configManager = new ConfigManager();
      const config = configManager.loadConfig();
      const dbManager = new DatabaseManager(config.database.url);
      const gitManager = new GitManager();

      await dbManager.initialize();

      // Create issue in database
      const issue = await dbManager.createIssue(
        title,
        options.description || '',
        options.priority || 'medium',
        options.phase
      );

      // Create Git branch
      try {
        await gitManager.createBranch(issue.branchName, 'main');
        spinner.succeed(`Created issue: ${issue.title}`);
      } catch (gitError) {
        spinner.warn(`Issue created but Git branch creation failed: ${gitError}`);
      }

      console.log(chalk.dim(`  ID: ${issue.id}`));
      console.log(chalk.dim(`  Priority: ${issue.priority}`));
      console.log(chalk.dim(`  Branch: ${issue.branchName}`));
      console.log(chalk.dim(`  Workflow Stage: ${issue.workflowStage}`));

    } catch (error) {
      spinner.fail('Failed to create issue');
      logger.error('Issue creation error:', error);
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  },

  async list(options: ListOptions): Promise<void> {
    try {
      const configManager = new ConfigManager();
      const config = configManager.loadConfig();
      const dbManager = new DatabaseManager(config.database.url);

      await dbManager.initialize();
      let issues = await dbManager.listIssues(options.status);

      // Filter by stage if specified
      if (options.stage) {
        issues = issues.filter(issue => issue.workflowStage === options.stage);
      }

      if (issues.length === 0) {
        console.log(chalk.yellow('No issues found.'));
        return;
      }

      console.log(chalk.bold.cyan('\n🐛 Issues\n'));

      // Table header
      console.log(
        chalk.bold(
          'ID'.padEnd(10) +
          'Title'.padEnd(35) +
          'Priority'.padEnd(10) +
          'Status'.padEnd(12) +
          'Stage'.padEnd(15) +
          'Created'
        )
      );
      console.log('─'.repeat(100));

      // Table rows
      for (const issue of issues) {
        const id = issue.id.substring(0, 8);
        const title = issue.title.length > 33 ? issue.title.substring(0, 30) + '...' : issue.title;
        const priority = issue.priority;
        const status = issue.status;
        const stage = issue.workflowStage.replace(/_/g, ' ');
        const created = issue.createdAt.toISOString().split('T')[0];

        const priorityColor = {
          critical: chalk.red,
          high: chalk.yellow,
          medium: chalk.blue,
          low: chalk.green
        }[priority] || chalk.white;

        const statusColor = {
          open: chalk.green,
          in_progress: chalk.yellow,
          blocked: chalk.red,
          closed: chalk.gray
        }[status] || chalk.white;

        console.log(
          chalk.cyan(id.padEnd(10)) +
          chalk.white(title.padEnd(35)) +
          priorityColor(priority.padEnd(10)) +
          statusColor(status.padEnd(12)) +
          chalk.blue(stage.padEnd(15)) +
          chalk.dim(created)
        );
      }

      console.log('');

    } catch (error) {
      logger.error('Failed to list issues:', error);
      console.error(chalk.red('✗'), 'Failed to list issues:', error);
      process.exit(1);
    }
  },

  async show(id: string): Promise<void> {
    try {
      const configManager = new ConfigManager();
      const config = configManager.loadConfig();
      const dbManager = new DatabaseManager(config.database.url);

      await dbManager.initialize();
      const issue = await dbManager.getIssue(id);

      if (!issue) {
        console.error(chalk.red('✗'), `Issue ${id} not found`);
        process.exit(1);
      }

      console.log(chalk.bold.cyan(`\n📌 Issue #${issue.id}\n`));

      console.log(chalk.green('Title:'), issue.title);
      console.log(chalk.green('Description:'), issue.description || chalk.dim('None'));
      console.log(chalk.green('Priority:'), issue.priority);
      console.log(chalk.green('Status:'), issue.status);
      console.log(chalk.green('Workflow Stage:'), issue.workflowStage);
      console.log(chalk.green('Branch:'), issue.branchName);
      console.log(chalk.green('Created:'), issue.createdAt.toISOString());

      if (issue.plan) {
        console.log('\n' + chalk.bold('📝 Implementation Plan:'));
        console.log(chalk.dim('─'.repeat(50)));
        console.log(issue.plan);
      }

      if (issue.diagnosisLog) {
        console.log('\n' + chalk.bold('🔍 Diagnosis Log:'));
        console.log(chalk.dim('─'.repeat(50)));
        console.log(issue.diagnosisLog);
      }

      // Get comments
      const comments = await dbManager.getComments(issue.id);
      if (comments.length > 0) {
        console.log('\n' + chalk.bold(`💬 Comments (${comments.length}):`));
        console.log(chalk.dim('─'.repeat(50)));

        for (const comment of comments) {
          const authorColor = comment.author === 'ai' ? chalk.blue : chalk.green;
          console.log(
            authorColor(`${comment.author}:`) +
            ' ' +
            comment.content
          );
          console.log(chalk.dim(comment.createdAt.toISOString()));
          console.log('');
        }
      }

    } catch (error) {
      logger.error('Failed to show issue:', error);
      console.error(chalk.red('✗'), 'Failed to show issue:', error);
      process.exit(1);
    }
  },

  async comment(id: string, message: string): Promise<void> {
    const spinner = ora('Adding comment...').start();

    try {
      const configManager = new ConfigManager();
      const config = configManager.loadConfig();
      const dbManager = new DatabaseManager(config.database.url);

      await dbManager.initialize();
      await dbManager.addComment(id, 'user', message);

      spinner.succeed(`Comment added to issue ${id}`);

    } catch (error) {
      spinner.fail('Failed to add comment');
      logger.error('Failed to add comment:', error);
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  },

  async approve(id: string): Promise<void> {
    const spinner = ora('Approving issue plan...').start();

    try {
      const configManager = new ConfigManager();
      const config = configManager.loadConfig();
      const dbManager = new DatabaseManager(config.database.url);

      await dbManager.initialize();

      // Get the issue to check current state
      const issue = await dbManager.getIssue(id);
      if (!issue) {
        spinner.fail(`Issue ${id} not found`);
        process.exit(1);
      }

      // Update workflow stage to implementing (from planning)
      await dbManager.updateIssueWorkflowStage(issue.id, 'implementing');

      // Add approval comment
      await dbManager.addComment(issue.id, 'user', '✅ Plan approved - proceeding with implementation');

      spinner.succeed(`Issue ${id} plan approved`);
      console.log(chalk.green(`✅ Plan approved for: ${issue.title}`));
      console.log(chalk.dim(`  Workflow stage updated to: implementing`));

    } catch (error) {
      spinner.fail('Failed to approve issue');
      logger.error('Failed to approve issue:', error);
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  },

  async reject(id: string, reason?: string): Promise<void> {
    const spinner = ora('Rejecting issue plan...').start();

    try {
      const configManager = new ConfigManager();
      const config = configManager.loadConfig();
      const dbManager = new DatabaseManager(config.database.url);

      await dbManager.initialize();

      // Get the issue to check current state
      const issue = await dbManager.getIssue(id);
      if (!issue) {
        spinner.fail(`Issue ${id} not found`);
        process.exit(1);
      }

      // Keep workflow stage at planning for regeneration
      await dbManager.updateIssueWorkflowStage(issue.id, 'planning');

      // Add rejection comment
      const rejectionMessage = reason
        ? `❌ Plan rejected - ${reason}. Please regenerate plan.`
        : '❌ Plan rejected - please regenerate plan.';

      await dbManager.addComment(issue.id, 'user', rejectionMessage);

      spinner.succeed(`Issue ${id} plan rejected`);
      console.log(chalk.yellow(`❌ Plan rejected for: ${issue.title}`));
      if (reason) {
        console.log(chalk.dim(`  Reason: ${reason}`));
      }
      console.log(chalk.dim(`  Workflow stage reset to: planning`));

    } catch (error) {
      spinner.fail('Failed to reject issue');
      logger.error('Failed to reject issue:', error);
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  },

  async open(id: string): Promise<void> {
    const spinner = ora('Opening issue...').start();

    try {
      const configManager = new ConfigManager();
      const config = configManager.loadConfig();
      const dbManager = new DatabaseManager(config.database.url);

      await dbManager.initialize();

      // Get the issue to check current state
      const issue = await dbManager.getIssue(id);
      if (!issue) {
        spinner.fail(`Issue ${id} not found`);
        process.exit(1);
      }

      // Update status to open
      await dbManager.updateIssueStatus(issue.id, 'open');

      // Add status change comment
      await dbManager.addComment(issue.id, 'user', '🔓 Issue reopened');

      spinner.succeed(`Issue ${id} opened`);
      console.log(chalk.green(`🔓 Opened: ${issue.title}`));

    } catch (error) {
      spinner.fail('Failed to open issue');
      logger.error('Failed to open issue:', error);
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  },

  async close(id: string): Promise<void> {
    const spinner = ora('Closing issue...').start();

    try {
      const configManager = new ConfigManager();
      const config = configManager.loadConfig();
      const dbManager = new DatabaseManager(config.database.url);

      await dbManager.initialize();

      // Get the issue to check current state
      const issue = await dbManager.getIssue(id);
      if (!issue) {
        spinner.fail(`Issue ${id} not found`);
        process.exit(1);
      }

      // Update status to closed and workflow stage to completed
      await dbManager.updateIssueStatus(issue.id, 'closed');
      await dbManager.updateIssueWorkflowStage(issue.id, 'completed');

      // Add status change comment
      await dbManager.addComment(issue.id, 'user', '🔒 Issue closed');

      spinner.succeed(`Issue ${id} closed`);
      console.log(chalk.gray(`🔒 Closed: ${issue.title}`));

    } catch (error) {
      spinner.fail('Failed to close issue');
      logger.error('Failed to close issue:', error);
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  }
};
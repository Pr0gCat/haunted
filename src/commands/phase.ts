/**
 * Phase commands - Manage project phases
 */

import chalk from 'chalk';
import ora from 'ora';
import { ConfigManager } from '../utils/config.js';
import { DatabaseManager } from '../services/database.js';
import { GitManager } from '../services/git-manager.js';
import { logger } from '../utils/logger.js';

export const phaseCommands = {
  async create(name: string, options: { description?: string }): Promise<void> {
    const spinner = ora('Creating phase...').start();

    try {
      const configManager = new ConfigManager();
      const config = configManager.loadConfig();
      const dbManager = new DatabaseManager(configManager.getDatabasePath());
      const gitManager = new GitManager();

      await dbManager.initialize();

      // Get current commit hash for generating phase ID
      let commitHash: string | undefined;
      try {
        await gitManager.initialize();
        commitHash = await gitManager.getCurrentCommitHash();
      } catch (error) {
        logger.warn('Could not get commit hash, using fallback ID generation:', error);
      }

      // Create phase in database
      const phase = await dbManager.createPhase(name, options.description, commitHash);

      // Create Git branch
      try {
        await gitManager.createBranch(phase.branchName, 'main');
        spinner.succeed(`Created phase: ${phase.name}`);
        console.log(chalk.dim(`  ID: ${phase.id}`));
        console.log(chalk.dim(`  Branch: ${phase.branchName}`));
      } catch (gitError) {
        spinner.warn(`Phase created but Git branch creation failed: ${gitError}`);
        console.log(chalk.dim(`  ID: ${phase.id}`));
        console.log(chalk.dim(`  Branch: ${phase.branchName} (not created)`));
      }

    } catch (error) {
      spinner.fail('Failed to create phase');
      logger.error('Phase creation error:', error);
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  },

  async list(): Promise<void> {
    try {
      const configManager = new ConfigManager();
      const config = configManager.loadConfig();
      const dbManager = new DatabaseManager(configManager.getDatabasePath());

      await dbManager.initialize();
      const phases = await dbManager.listPhases();

      if (phases.length === 0) {
        console.log(chalk.yellow('No phases found.'));
        return;
      }

      console.log(chalk.bold.cyan('\n📋 Phases\n'));

      // Table header
      console.log(
        chalk.bold(
          'ID'.padEnd(10) +
          'Name'.padEnd(25) +
          'Status'.padEnd(12) +
          'Branch'.padEnd(30) +
          'Created'
        )
      );
      console.log('─'.repeat(90));

      // Table rows
      for (const phase of phases) {
        const id = phase.id.substring(0, 8);
        const name = phase.name.substring(0, 23);
        const status = phase.status;
        const branch = phase.branchName.substring(0, 28);
        const created = phase.createdAt.toISOString().split('T')[0];

        const statusColor = {
          planning: chalk.blue,
          active: chalk.green,
          completed: chalk.gray,
          archived: chalk.dim
        }[status] || chalk.white;

        console.log(
          chalk.cyan(id.padEnd(10)) +
          chalk.green(name.padEnd(25)) +
          statusColor(status.padEnd(12)) +
          chalk.blue(branch.padEnd(30)) +
          chalk.dim(created)
        );
      }

      console.log('');

    } catch (error) {
      logger.error('Failed to list phases:', error);
      console.error(chalk.red('✗'), 'Failed to list phases:', error);
      process.exit(1);
    }
  }
};
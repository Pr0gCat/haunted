/**
 * Init command - Initialize Haunted in a project
 */

import chalk from 'chalk';
import ora from 'ora';
import { ConfigManager } from '../utils/config.js';
import { DatabaseManager } from '../services/database.js';
import { GitManager } from '../services/git-manager.js';
import { ClaudeCodeWrapper } from '../services/claude-wrapper.js';
import { logger } from '../utils/logger.js';

export async function initCommand(): Promise<void> {
  const spinner = ora('Initializing Haunted...').start();

  try {
    // Check if already initialized
    const configManager = new ConfigManager();
    if (configManager.isInitialized()) {
      spinner.warn('Haunted is already initialized in this project.');
      return;
    }

    // Check Git repository
    spinner.text = 'Checking Git repository...';
    const gitManager = new GitManager();

    try {
      await gitManager.initialize();
      const branch = await gitManager.getCurrentBranch();
      spinner.succeed(`Git repository detected: ${branch}`);
    } catch (error) {
      spinner.info('Initializing Git repository...');
      await gitManager.initializeRepo();
      spinner.succeed('Git repository initialized');
    }

    // Check Claude Code CLI
    spinner.start('Checking Claude Code CLI...');
    const claude = new ClaudeCodeWrapper();

    try {
      const isAvailable = await claude.checkAvailability();
      if (isAvailable) {
        spinner.succeed('Claude Code CLI is available');
      } else {
        spinner.warn('Claude Code CLI not found - install from https://claude.ai/download');
      }
    } catch (error) {
      spinner.warn(`Could not verify Claude Code: ${error}`);
    }

    // Create configuration
    spinner.start('Creating configuration...');
    const config = configManager.createDefaultConfig();
    await configManager.saveConfig(config);
    spinner.succeed('Configuration created');

    // Initialize database
    spinner.start('Setting up database...');
    const dbManager = new DatabaseManager(configManager.getDatabasePath());
    await dbManager.initialize();
    spinner.succeed('Database initialized');

    // Success message
    console.log('');
    console.log(chalk.green.bold('✨ Haunted initialized successfully!'));
    console.log('');
    console.log('Next steps:');
    console.log(chalk.cyan('  1. Create a phase:  ') + chalk.white('haunted phase create "Phase 1"'));
    console.log(chalk.cyan('  2. Create an issue: ') + chalk.white('haunted issue create "Implement feature"'));
    console.log(chalk.cyan('  3. Start the daemon:') + chalk.white('haunted start'));
    console.log('');
    console.log(chalk.dim('Note: Haunted uses Claude Code CLI.'));

  } catch (error) {
    spinner.fail('Initialization failed');
    logger.error('Initialization error:', error);
    console.error(chalk.red('Error:'), error);
    process.exit(1);
  }
}
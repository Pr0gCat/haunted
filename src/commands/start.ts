/**
 * Start command - Start the Haunted daemon
 */

import chalk from 'chalk';
import { ConfigManager } from '../utils/config.js';
import { HauntedDaemon } from '../services/daemon.js';
import { logger } from '../utils/logger.js';

interface StartOptions {
  background?: boolean;
}

export async function startCommand(options: StartOptions): Promise<void> {
  try {
    // Check if initialized
    const configManager = new ConfigManager();
    if (!configManager.isInitialized()) {
      console.error(chalk.red('✗'), 'Project not initialized. Run', chalk.cyan('haunted init'), 'first.');
      process.exit(1);
    }

    // Load configuration
    const config = configManager.loadConfig();

    if (options.background) {
      console.log(chalk.yellow('Background mode not implemented yet.'));
      return;
    }

    console.log(chalk.cyan('Starting Haunted daemon...'));
    console.log(chalk.dim('Press Ctrl+C to stop'));
    console.log('');

    // Start daemon
    const daemon = new HauntedDaemon(config);

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n' + chalk.yellow('Stopping daemon...'));
      await daemon.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      await daemon.stop();
      process.exit(0);
    });

    await daemon.start();

  } catch (error) {
    logger.error('Failed to start daemon:', error);
    console.error(chalk.red('✗'), 'Failed to start daemon:', error);
    process.exit(1);
  }
}
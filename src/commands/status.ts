/**
 * Status command - Show Haunted project status
 */

import chalk from 'chalk';
import { ConfigManager } from '../utils/config.js';
import { DatabaseManager } from '../services/database.js';
import { GitManager } from '../services/git-manager.js';
import { logger } from '../utils/logger.js';

export async function statusCommand(): Promise<void> {
  try {
    // Check if initialized
    const configManager = new ConfigManager();
    if (!configManager.isInitialized()) {
      console.error(chalk.red('✗'), 'Project not initialized.');
      process.exit(1);
    }

    // Load configuration and database
    const config = configManager.loadConfig();
    const dbManager = new DatabaseManager(configManager.getDatabasePath());
    await dbManager.initialize();

    // Get issue statistics
    const stats = await dbManager.getIssueStats();

    // Display issue statistics
    console.log(chalk.bold.cyan('\n📊 Haunted Status\n'));

    console.log(chalk.bold('Issues:'));
    console.log(`  ${chalk.green('Open:')}        ${stats.open}`);
    console.log(`  ${chalk.yellow('In Progress:')} ${stats.in_progress}`);
    console.log(`  ${chalk.red('Blocked:')}     ${stats.blocked}`);
    console.log(`  ${chalk.dim('Closed:')}      ${stats.closed}`);

    // Display workflow stages
    if (Object.keys(stats.workflowStages).some(k => stats.workflowStages[k as keyof typeof stats.workflowStages] > 0)) {
      console.log('\n' + chalk.bold('Workflow Stages:'));
      for (const [stage, count] of Object.entries(stats.workflowStages)) {
        if (count > 0) {
          const formattedStage = stage.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
          console.log(`  ${chalk.blue(formattedStage + ':')} ${count}`);
        }
      }
    }

    // Git status
    try {
      const gitManager = new GitManager();
      const gitStatus = await gitManager.getRepositoryStatus();

      console.log('\n' + chalk.bold('Git Status:'));
      console.log(`  ${chalk.cyan('Current Branch:')}  ${gitStatus.currentBranch}`);
      console.log(`  ${chalk.yellow('Is Dirty:')}        ${gitStatus.isDirty ? 'Yes' : 'No'}`);
      console.log(`  ${chalk.blue('Untracked Files:')} ${gitStatus.untrackedFiles.length}`);
      console.log(`  ${chalk.magenta('Modified Files:')}  ${gitStatus.modifiedFiles.length}`);
      console.log(`  ${chalk.red('Has Conflicts:')}   ${gitStatus.hasConflicts ? 'Yes' : 'No'}`);
    } catch (error) {
      console.log('\n' + chalk.yellow('Git status unavailable:'), error);
    }

    console.log('');

  } catch (error) {
    logger.error('Failed to get status:', error);
    console.error(chalk.red('✗'), 'Failed to get status:', error);
    process.exit(1);
  }
}
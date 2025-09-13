#!/usr/bin/env node
/**
 * Haunted CLI - Command Line Interface
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { VERSION } from '../index.js';
import { initCommand } from '../commands/init.js';
import { startCommand } from '../commands/start.js';
import { statusCommand } from '../commands/status.js';
import { phaseCommands } from '../commands/phase.js';
import { issueCommands } from '../commands/issue.js';
import { setupLogger } from '../utils/logger.js';

export class HauntedCLI {
  private program: Command;

  constructor() {
    this.program = new Command();
    this.setupProgram();
  }

  private setupProgram(): void {
    this.program
      .name('haunted')
      .description('👻 Spectral Software Solutions - AI-powered development with automated workflow management')
      .version(VERSION)
      .option('-v, --verbose', 'Enable verbose logging')
      .option('--log-file <path>', 'Log file path')
      .hook('preAction', (thisCommand) => {
        const opts = thisCommand.opts();
        setupLogger({
          level: opts.verbose ? 'debug' : 'info',
          file: opts.logFile
        });
      });

    // Add commands
    this.program
      .command('init')
      .description('Initialize Haunted in the current project')
      .action(initCommand);

    this.program
      .command('start')
      .description('Start the Haunted daemon')
      .option('-b, --background', 'Run daemon in background')
      .action(startCommand);


    this.program
      .command('status')
      .description('Show Haunted status')
      .action(statusCommand);

    // Phase commands
    const phase = this.program
      .command('phase')
      .description('Manage project phases');

    phase
      .command('create <name>')
      .description('Create a new phase')
      .option('-d, --description <text>', 'Phase description')
      .action(phaseCommands.create);

    phase
      .command('list')
      .description('List all phases')
      .action(phaseCommands.list);

    // Issue commands
    const issue = this.program
      .command('issue')
      .description('Manage issues');

    issue
      .command('create <title>')
      .description('Create a new issue')
      .option('-d, --description <text>', 'Issue description', '')
      .option('-p, --priority <level>', 'Issue priority', 'medium')
      .option('--phase <id>', 'Phase ID')
      .action(issueCommands.create);

    issue
      .command('list')
      .description('List issues')
      .option('--status <status>', 'Filter by status')
      .option('--stage <stage>', 'Filter by workflow stage')
      .action(issueCommands.list);

    issue
      .command('show <id>')
      .description('Show issue details')
      .action(issueCommands.show);

    issue
      .command('comment <id> <message>')
      .description('Add comment to issue')
      .action(issueCommands.comment);

    issue
      .command('approve <id>')
      .description('Approve issue plan')
      .action(issueCommands.approve);

    issue
      .command('reject <id> [reason]')
      .description('Reject issue plan')
      .action(issueCommands.reject);

    issue
      .command('open <id>')
      .description('Reopen closed issue')
      .action(issueCommands.open);

    issue
      .command('close <id>')
      .description('Close issue')
      .action(issueCommands.close);
  }

  async run(argv?: string[]): Promise<void> {
    try {
      await this.program.parseAsync(argv || process.argv);
    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  }
}

// Run CLI if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const cli = new HauntedCLI();
  cli.run().catch((error) => {
    console.error(chalk.red('Fatal error:'), error);
    process.exit(1);
  });
}
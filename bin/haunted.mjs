#!/usr/bin/env node

/**
 * Haunted CLI Executable
 * This is the main executable entry point for the haunted npm package
 */

import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Determine the path to the CLI module
const cliPath = join(__dirname, '..', 'dist', 'cli', 'index.js');
const cliUrl = pathToFileURL(cliPath).href;

try {
  // Import and run the CLI
  const { HauntedCLI } = await import(cliUrl);
  const cli = new HauntedCLI();
  await cli.run();
} catch (error) {
  if (error.code === 'MODULE_NOT_FOUND') {
    console.error('Error: Haunted CLI not found. Please ensure the package is properly installed.');
    console.error('If you installed from source, make sure to run: npm run build');
  } else {
    console.error('Error starting Haunted CLI:', error.message);
  }
  process.exit(1);
}
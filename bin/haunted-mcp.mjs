#!/usr/bin/env node

/**
 * Haunted MCP Server Executable
 * Starts the MCP server for Claude integration
 */

import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Determine the path to the MCP server module
const mcpPath = join(__dirname, '..', 'dist', 'mcp', 'index.js');
const mcpUrl = pathToFileURL(mcpPath).href;

try {
  // Import and run the MCP server
  const { HauntedMCPServer } = await import(mcpUrl);
  const server = new HauntedMCPServer();
  await server.start();
} catch (error) {
  if (error.code === 'MODULE_NOT_FOUND') {
    console.error('Error: Haunted MCP server not found. Please ensure the package is properly installed.');
    console.error('If you installed from source, make sure to run: npm run build');
  } else {
    console.error('Error starting Haunted MCP server:', error.message);
  }
  process.exit(1);
}
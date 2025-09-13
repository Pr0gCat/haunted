/**
 * Haunted CLI - Main Library Export
 * Provides programmatic access to Haunted functionality
 */

export * from './services/database.js';
export * from './services/git-manager.js';
export * from './services/claude-wrapper.js';
export * from './services/workflow-engine.js';
export * from './models/index.js';
export * from './utils/config.js';
export * from './utils/logger.js';

export { HauntedCLI } from './cli/index.js';

export const VERSION = '0.2.0';
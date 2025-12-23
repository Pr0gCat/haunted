/**
 * Haunted - Main Library Export
 * GitHub-integrated autonomous development service powered by Claude Code
 */

// Core services
export { GitHubService } from './services/github/index.js';
export { GitService, WorktreeManager } from './services/git/index.js';
export { ClaudeService } from './services/claude/index.js';
export { NotificationService } from './services/notification/index.js';

// Orchestrator
export { Orchestrator, RunnerPool, TaskQueue } from './orchestrator/index.js';

// Workflow
export { WorkflowEngine } from './workflow/index.js';

// Models
export * from './models/index.js';

// Utilities
export { ConfigManager } from './utils/config.js';
export { logger } from './utils/logger.js';

// Legacy exports (deprecated - will be removed in v1.0.0)
export { DatabaseManager } from './services/database.js';
export { GitManager } from './services/git-manager.js';
export { ClaudeCodeWrapper } from './services/claude-wrapper.js';
export { WorkflowEngine as LegacyWorkflowEngine } from './services/workflow-engine.js';

// CLI
export { HauntedCLI } from './cli/index.js';

export const VERSION = '0.3.0';

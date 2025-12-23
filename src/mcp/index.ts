/**
 * @deprecated This module is deprecated and will be removed in v1.0.0
 * The new architecture uses GitHub Actions Runner instead of MCP Server
 *
 * MCP Server Implementation for Haunted (LEGACY)
 * Provides tools for Claude to interact with Haunted functionality
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  CallToolRequest,
  ErrorCode,
  McpError
} from '@modelcontextprotocol/sdk/types.js';
import { DatabaseManager } from '../services/database.js';
import { GitManager } from '../services/git-manager.js';
import { ClaudeCodeWrapper } from '../services/claude-wrapper.js';
import { WorkflowEngine } from '../services/workflow-engine.js';
import { ConfigManager } from '../utils/config.js';
import { logger } from '../utils/logger.js';

export class HauntedMCPServer {
  private server: Server;
  private db!: DatabaseManager;
  private git!: GitManager;
  private claude!: ClaudeCodeWrapper;
  private workflow!: WorkflowEngine;

  constructor() {
    this.server = new Server(
      {
        name: 'haunted-mcp-server',
        version: '0.2.0'
      },
      {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {}
        }
      }
    );

    this.setupTools();
    this.setupEventHandlers();
  }

  private async initialize(): Promise<void> {
    try {
      const configManager = new ConfigManager();
      configManager.loadConfig(); // Load config but we don't need to store it

      this.db = new DatabaseManager(configManager.getDatabasePath());
      await this.db.initialize();

      this.git = new GitManager(configManager.getProjectRoot());
      await this.git.initialize();

      this.claude = new ClaudeCodeWrapper('claude');
      this.workflow = new WorkflowEngine(this.db, this.git, this.claude);

      logger.info('Haunted MCP Server initialized');
    } catch (error) {
      logger.error('MCP Server initialization failed:', error);
      throw error;
    }
  }

  private setupTools(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'create_issue',
          description: 'Create a new issue in Haunted',
          inputSchema: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Issue title' },
              description: { type: 'string', description: 'Issue description' },
              priority: {
                type: 'string',
                enum: ['low', 'medium', 'high', 'critical'],
                description: 'Issue priority'
              },
              phaseId: { type: 'string', description: 'Phase ID (optional)' }
            },
            required: ['title', 'description']
          }
        },
        {
          name: 'list_issues',
          description: 'List issues with optional filtering',
          inputSchema: {
            type: 'object',
            properties: {
              status: {
                type: 'string',
                enum: ['open', 'in_progress', 'blocked', 'closed'],
                description: 'Filter by status'
              },
              stage: { type: 'string', description: 'Filter by workflow stage' }
            }
          }
        },
        {
          name: 'get_issue',
          description: 'Get detailed information about an issue',
          inputSchema: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Issue ID' }
            },
            required: ['id']
          }
        },
        {
          name: 'update_issue_status',
          description: 'Update the status of an issue',
          inputSchema: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Issue ID' },
              status: {
                type: 'string',
                enum: ['open', 'in_progress', 'blocked', 'closed'],
                description: 'New status'
              }
            },
            required: ['id', 'status']
          }
        },
        {
          name: 'add_comment',
          description: 'Add a comment to an issue',
          inputSchema: {
            type: 'object',
            properties: {
              issueId: { type: 'string', description: 'Issue ID' },
              author: { type: 'string', description: 'Comment author' },
              content: { type: 'string', description: 'Comment content' }
            },
            required: ['issueId', 'author', 'content']
          }
        },
        {
          name: 'create_phase',
          description: 'Create a new project phase',
          inputSchema: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Phase name' },
              description: { type: 'string', description: 'Phase description' }
            },
            required: ['name']
          }
        },
        {
          name: 'list_phases',
          description: 'List all project phases',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },
        {
          name: 'git_status',
          description: 'Get the current Git repository status',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },
        {
          name: 'git_create_branch',
          description: 'Create a new Git branch',
          inputSchema: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Branch name' },
              from: { type: 'string', description: 'Base branch (default: main)' }
            },
            required: ['name']
          }
        },
        {
          name: 'process_issue',
          description: 'Process an issue through the workflow engine',
          inputSchema: {
            type: 'object',
            properties: {
              issueId: { type: 'string', description: 'Issue ID to process' }
            },
            required: ['issueId']
          }
        },
        {
          name: 'analyze_issue',
          description: 'Analyze an issue and create implementation plan',
          inputSchema: {
            type: 'object',
            properties: {
              issueId: { type: 'string', description: 'Issue ID to analyze' }
            },
            required: ['issueId']
          }
        },
        {
          name: 'project_stats',
          description: 'Get project statistics and overview',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        }
      ]
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'create_issue':
            return await this.handleCreateIssue(args);

          case 'list_issues':
            return await this.handleListIssues(args);

          case 'get_issue':
            return await this.handleGetIssue(args);

          case 'update_issue_status':
            return await this.handleUpdateIssueStatus(args);

          case 'add_comment':
            return await this.handleAddComment(args);

          case 'create_phase':
            return await this.handleCreatePhase(args);

          case 'list_phases':
            return await this.handleListPhases(args);

          case 'git_status':
            return await this.handleGitStatus(args);

          case 'git_create_branch':
            return await this.handleGitCreateBranch(args);

          case 'process_issue':
            return await this.handleProcessIssue(args);

          case 'analyze_issue':
            return await this.handleAnalyzeIssue(args);

          case 'project_stats':
            return await this.handleProjectStats(args);

          default:
            throw new McpError(ErrorCode.MethodNotFound, `Tool ${name} not found`);
        }
      } catch (error) {
        logger.error(`Tool ${name} failed:`, error);
        throw new McpError(ErrorCode.InternalError, `Tool ${name} failed: ${error}`);
      }
    });
  }

  private setupEventHandlers(): void {
    this.server.onerror = (error) => {
      logger.error('MCP Server error:', error);
    };

    process.on('SIGINT', async () => {
      logger.info('Shutting down MCP server...');
      await this.server.close();
      process.exit(0);
    });
  }

  // Tool handlers
  private async handleCreateIssue(args: any) {
    const issue = await this.db.createIssue(
      args.title,
      args.description,
      args.priority || 'medium',
      args.phaseId
    );

    try {
      await this.git.createBranch(issue.branchName, 'main');
    } catch (error) {
      logger.warn(`Failed to create Git branch for issue ${issue.id}:`, error);
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(issue, null, 2)
        }
      ]
    };
  }

  private async handleListIssues(args: any) {
    const issues = await this.db.listIssues(args.status, args.stage);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(issues, null, 2)
        }
      ]
    };
  }

  private async handleGetIssue(args: any) {
    const issue = await this.db.getIssue(args.id);

    if (!issue) {
      throw new McpError(ErrorCode.InvalidParams, `Issue ${args.id} not found`);
    }

    const comments = await this.db.getComments(issue.id);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ issue, comments }, null, 2)
        }
      ]
    };
  }

  private async handleUpdateIssueStatus(args: any) {
    await this.db.updateIssueStatus(args.id, args.status);

    return {
      content: [
        {
          type: 'text',
          text: `Updated issue ${args.id} status to ${args.status}`
        }
      ]
    };
  }

  private async handleAddComment(args: any) {
    const comment = await this.db.addComment(args.issueId, args.author, args.content);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(comment, null, 2)
        }
      ]
    };
  }

  private async handleCreatePhase(args: any) {
    const phase = await this.db.createPhase(args.name, args.description);

    try {
      await this.git.createBranch(phase.branchName, 'main');
    } catch (error) {
      logger.warn(`Failed to create Git branch for phase ${phase.id}:`, error);
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(phase, null, 2)
        }
      ]
    };
  }

  private async handleListPhases(_args: any) {
    const phases = await this.db.listPhases();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(phases, null, 2)
        }
      ]
    };
  }

  private async handleGitStatus(_args: any) {
    const status = await this.git.getRepositoryStatus();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(status, null, 2)
        }
      ]
    };
  }

  private async handleGitCreateBranch(args: any) {
    await this.git.createBranch(args.name, args.from || 'main');

    return {
      content: [
        {
          type: 'text',
          text: `Created branch: ${args.name}`
        }
      ]
    };
  }

  private async handleProcessIssue(args: any) {
    const issue = await this.db.getIssue(args.issueId);

    if (!issue) {
      throw new McpError(ErrorCode.InvalidParams, `Issue ${args.issueId} not found`);
    }

    const result = await this.workflow.processIssue(issue);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  }

  private async handleAnalyzeIssue(args: any) {
    const issue = await this.db.getIssue(args.issueId);

    if (!issue) {
      throw new McpError(ErrorCode.InvalidParams, `Issue ${args.issueId} not found`);
    }

    const analysis = await this.claude.analyzeAndPlan(issue);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(analysis, null, 2)
        }
      ]
    };
  }

  private async handleProjectStats(_args: any) {
    const stats = await this.db.getIssueStats();
    const gitStatus = await this.git.getRepositoryStatus();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ issueStats: stats, gitStatus }, null, 2)
        }
      ]
    };
  }

  async start(): Promise<void> {
    await this.initialize();

    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    logger.info('Haunted MCP server started');
  }
}

// Export for library use
export { HauntedMCPServer as default };
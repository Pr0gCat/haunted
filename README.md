# 👻 Haunted CLI - Spectral Software Solutions

**Your codebase just got possessed by supernatural development powers.**

Transform your development workflow with an autonomous AI spirit that thinks, codes, and ships features while you focus on the bigger picture. Haunted doesn't just assist - it possesses your repository and handles complete development cycles from planning to deployment.

**🌙 No API Séance Required** - Seamlessly channels your Claude Code authentication for effortless spectral integration.

[![npm version](https://badge.fury.io/js/haunted-cli.svg)](https://badge.fury.io/js/haunted-cli)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-43853D?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 📖 Table of Contents

- [Supernatural Features](#-supernatural-features)
- [Summoning Requirements](#️-summoning-requirements)
- [Installation](#-possession-ritual)
- [Quick Start](#-summoning-your-spectral-developer)
- [Workflow](#workflow)
- [Commands](#commands)
- [MCP Server](#-mcp-server)
- [Configuration](#configuration)
- [Architecture](#architecture)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Contributing](#contributing)

## 🔮 Supernatural Features

- **👻 Spectral Authentication**: No API keys needed - channels your Claude Code powers directly
- **🎭 Autonomous Possession**: AI takes complete ownership of features from concept to deployment
- **🌙 Concurrent Hauntings**: Multiple issues developed simultaneously across your codebase
- **🕯️ Self-Exorcising**: When bugs appear, the spirit debugs and fixes itself automatically
- **🦇 Git Manifestation**: Automatic branch creation, testing, and merging with ghostly precision
- **👺 Issue-Driven Séances**: All development starts from clear issue descriptions and priorities
- **🎃 Spectral Workflow**: Complete development lifecycle - Plan → Code → Test → Debug → Ship
- **📡 MCP Integration**: Model Context Protocol server for direct Claude communication

## 🕯️ Summoning Requirements

- **Node.js 20+** - The vessel for spectral powers (TypeScript edition)
- **Claude Code CLI** - Your gateway to the supernatural realm

## 🎭 Possession Ritual

```bash
# Global spectral possession
npm install -g haunted-cli

# Or channel directly with npx
npx haunted-cli

# For development possession
git clone <repository-url>
cd haunted
npm install
npm run build
```

**🌙 The possession is complete!** No API keys needed - Haunted channels your Claude Code authentication automatically.

### 🔮 Confirm the Haunting

```bash
# Test the spectral connection
haunted --help

# Or with npx
npx haunted-cli --help
```

## 🌙 Summoning Your Spectral Developer

### 1. Begin the Possession

```bash
# Invite the spirit into your project
haunted init
```

This spectral ritual will:
- Manifest `.haunted/` sanctuary with database and config
- Verify your Git repository is ready for haunting
- Establish supernatural configuration

### 2. Whisper Your Desires

```bash
# Communicate your high-priority wish to the spirit
haunted issue create "Implement user authentication" --priority high --description "Add login/logout functionality with JWT tokens"

# Organize supernatural work into phases
haunted phase create "Phase 1 - Core Features" --description "Essential features for MVP"

# Channel additional requests into specific phases
haunted issue create "Add password reset" --phase <phase-id> --priority medium
```

### 3. Release the Autonomous Spirit

```bash
# Unleash your spectral developer
haunted start
```

Your ghostly assistant will:
- Scan for open Issues by supernatural priority
- Manifest Git branches for each spectral task
- Possess your codebase through the complete development cycle
- Automatically merge completed hauntings

### 4. Monitor Progress

```bash
# Check overall status
haunted status

# List all issues
haunted issue list

# View specific issue details
haunted issue show <issue-id>

# View issues by status
haunted issue list --status in_progress
```

## Workflow

Haunted implements a flexible development workflow (see `docs/DEVELOPMENT_WORKFLOW.md` for details):

1. **Plan (計劃)**: AI analyzes requirements and creates implementation strategy
2. **Implement (實作)**: AI writes code following the plan
3. **Unit Test (單元測試)**: AI creates and runs unit tests
4. **Fix Issues (問題修復)**: AI fixes any test failures
5. **Integration Test (整合測試)**: AI runs integration tests
6. **Diagnose (診斷)**: If integration tests fail, AI diagnoses and replans
7. **Done (完成)**: Issue completed and merged

This workflow prioritizes implementation-first approach with multi-layer testing validation.

## Commands

### Core Commands

- `haunted init` - Initialize Haunted in current project
- `haunted start` - Start the AI daemon
- `haunted status` - Show current status

### Issue Management

- `haunted issue create <title>` - Create new issue
- `haunted issue list` - List all issues
- `haunted issue show <id>` - Show issue details
- `haunted issue comment <id> <message>` - Add comment to issue
- `haunted issue approve <id>` - Approve issue plan
- `haunted issue reject <id> [reason]` - Reject issue plan
- `haunted issue open <id>` - Reopen closed issue
- `haunted issue close <id>` - Close issue

### Phase Management

- `haunted phase create <name>` - Create new phase
- `haunted phase list` - List all phases

## Configuration

Configuration is stored in `.haunted/config.json`:

```json
{
  "project": {
    "name": "your-project",
    "root": "/path/to/project"
  },
  "database": {
    "url": "/path/to/.haunted/database.db"
  },
  "claude": {
    "command": "claude",
    "maxTokens": 4000,
    "temperature": 0.7
  },
  "workflow": {
    "autoProcess": true,
    "checkInterval": 30000,
    "maxRetries": 3
  },
  "logging": {
    "level": "info"
  }
}
```

## Architecture

```
haunted-cli/
├── bin/                   # Executable scripts
│   ├── haunted.mjs              # Main CLI entry point
│   └── haunted-mcp.mjs          # MCP server entry point
├── src/
│   ├── cli/               # Command-line interface
│   │   └── index.ts             # CLI setup and command routing
│   ├── commands/          # Individual command implementations
│   │   ├── init.ts              # Project initialization
│   │   ├── issue.ts             # Issue management commands
│   │   ├── phase.ts             # Phase management commands
│   │   ├── start.ts             # Daemon start command
│   │   └── status.ts            # Status display command
│   ├── services/          # Core business logic
│   │   ├── claude-wrapper.ts    # Claude Code CLI integration
│   │   ├── workflow-engine.ts   # Workflow state machine
│   │   ├── database.ts          # SQLite database management
│   │   ├── git-manager.ts       # Git operations (simple-git)
│   │   └── daemon.ts            # Background service
│   ├── models/            # TypeScript data models
│   │   └── index.ts             # Issue, Phase, Comment types
│   ├── mcp/               # MCP server for Claude integration
│   │   └── index.ts             # MCP server implementation
│   └── utils/             # Utilities
│       ├── config.ts            # Configuration management
│       ├── logger.ts            # Winston logger setup
│       └── greeting.ts          # Greeting utilities
├── docs/                  # Documentation
│   └── DEVELOPMENT_WORKFLOW.md  # Development workflow guide
└── .haunted/              # Project data (created after init)
    ├── config.json              # Project configuration
    └── database.db              # SQLite database
```

## Development Workflow Integration

Haunted is designed to work with your existing development workflow:

1. **Create Issues** for features, bugs, or tasks
2. **Let AI work** - Haunted processes Issues autonomously
3. **Review Results** - Check AI's work in Git branches
4. **Provide Feedback** - Add comments to blocked Issues
5. **Merge & Deploy** - Completed Issues are auto-merged

## Git Branch Strategy

- **main**: Production branch
- **phase/<name>**: Phase branches for organizing work
- **issue/<id>**: Individual Issue branches
- Auto-merge: Issues -> Phases -> Main (when ready)

## 🔌 MCP Server

Haunted includes an MCP (Model Context Protocol) server that enables direct integration with Claude Desktop and other MCP-compatible clients.

### Setting Up MCP Server

Add the following configuration to your Claude Desktop settings:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "haunted": {
      "command": "npx",
      "args": ["haunted-cli", "mcp"]
    }
  }
}
```

Or if installed globally:

```json
{
  "mcpServers": {
    "haunted": {
      "command": "haunted-mcp"
    }
  }
}
```

### Available MCP Tools

Once configured, Claude has access to comprehensive tools:

| Tool | Description |
|------|-------------|
| `create_issue` | Create a new issue with title, description, and priority |
| `list_issues` | List issues with optional status/stage filtering |
| `get_issue` | Get detailed information about a specific issue |
| `update_issue_status` | Update issue status (open, in_progress, blocked, closed) |
| `add_comment` | Add a comment to an issue |
| `create_phase` | Create a new project phase |
| `list_phases` | List all project phases |
| `git_status` | Get current Git repository status |
| `git_create_branch` | Create a new Git branch |
| `process_issue` | Process an issue through the workflow engine |
| `analyze_issue` | Analyze an issue and create implementation plan |
| `project_stats` | Get project statistics and overview |

## Troubleshooting

### Common Issues

1. **Claude Code not authenticated**: Run `claude login` first
2. **Claude Code not installed**: Install from https://claude.ai/download
3. **Node.js version < 20**: Upgrade to Node.js 20 or higher
4. **Not a Git repository**: Run `git init` first
5. **Database errors**: Delete `.haunted/database.db` and reinitialize

### Logs

Enable verbose logging:
```bash
haunted --verbose start
```

Or specify log file:
```bash
haunted --log-file haunted.log start
```

## Examples

### Basic Workflow

```bash
# Initialize project
haunted init

# Create issues
haunted issue create "Add user model" --priority high
haunted issue create "Implement API endpoints" --priority high
haunted issue create "Add input validation" --priority medium

# Start AI processing
haunted start

# Monitor progress
watch haunted status
```

### Issue Management

```bash
# View issue details
haunted issue show abc123

# Add clarification comment
haunted issue comment abc123 "Please use bcrypt for password hashing"

# Check all open issues
haunted issue list --status open

# Approve or reject AI's implementation plan
haunted issue approve abc123
haunted issue reject abc123 "Need more detailed error handling"

# Manage issue lifecycle
haunted issue close abc123
haunted issue open abc123
```

## Development

```bash
# Clone and install dependencies
git clone https://github.com/progcat/haunted.git
cd haunted
npm install

# Build the project
npm run build

# Run in development mode (with hot reload)
npm run dev

# Run tests
npm test

# Run tests with watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Type checking
npm run typecheck

# Linting
npm run lint

# Fix linting issues
npm run lint:fix

# Format code
npm run format
```

### Tech Stack

- **Runtime**: Node.js 20+
- **Language**: TypeScript 5.7+
- **Build Tool**: tsup
- **Testing**: Vitest
- **Database**: SQLite (via better-sqlite3)
- **Git Operations**: simple-git
- **CLI Framework**: Commander.js
- **MCP SDK**: @modelcontextprotocol/sdk

## Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature/name`
3. Make changes and test
4. Run `npm run lint` and `npm test` to ensure code quality
5. Submit pull request

## License

MIT License - see [LICENSE](LICENSE) file for details.

---

<p align="center">
  <strong>👻 Happy Haunting! 👻</strong><br>
  <sub>Made with supernatural powers by <a href="https://github.com/progcat">ProgCat</a></sub>
</p>
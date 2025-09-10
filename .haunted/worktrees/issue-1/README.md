# 👻 Haunted - Spectral Software Solutions

**Your codebase just got possessed by supernatural development powers.**

Transform your development workflow with an autonomous AI spirit that thinks, codes, and ships features while you focus on the bigger picture. Haunted doesn't just assist - it possesses your repository and handles complete development cycles from planning to deployment.

**🌙 No API Séance Required** - Seamlessly channels your Claude Code authentication for effortless spectral integration.

[繁體中文 README](README_zh-TW.md) | [English](#)

## 🔮 Supernatural Features

- **👻 Spectral Authentication**: No API keys needed - channels your Claude Code powers directly
- **🎭 Autonomous Possession**: AI takes complete ownership of features from concept to deployment
- **🌙 Concurrent Hauntings**: Multiple issues developed simultaneously across your codebase
- **🕯️ Self-Exorcising**: When bugs appear, the spirit debugs and fixes itself automatically  
- **🦇 Git Manifestation**: Automatic branch creation, testing, and merging with ghostly precision
- **👺 Issue-Driven Séances**: All development starts from clear issue descriptions and priorities
- **🎃 Spectral Workflow**: Complete development lifecycle - Plan → Code → Test → Debug → Ship

## 🕯️ Summoning Requirements

- **Python 3.10+** - The vessel for spectral powers
- **Node.js 18+** - Required for Claude Code channeling
- **Claude Code CLI** - Your gateway to the supernatural realm:

```bash
# Install Claude Code CLI
npm install -g @anthropic-ai/claude-code

# Authenticate with the spirit realm (this opens the portal!)
claude login
```

## 🎭 Possession Ritual

```bash
# Instant spectral possession (recommended)
uvx haunted

# Or summon globally with pipx
pipx install haunted

# For development possession
git clone <repository-url>
cd haunted
uv sync
```

**🌙 The possession is complete!** No API keys needed - Haunted channels your Claude Code authentication automatically.

### 🔮 Confirm the Haunting

```bash
# Test the spectral connection
uvx haunted --help

# For pipx installation
haunted --help
```

## 🌙 Summoning Your Spectral Developer

### 1. Begin the Possession

```bash
# Invite the spirit into your project
uvx haunted init

# Or if globally installed with pipx
haunted init
```

This spectral ritual will:
- Manifest `.haunted/` sanctuary with database and config
- Verify your Git repository is ready for haunting
- Establish supernatural configuration

### 2. Whisper Your Desires

```bash
# Communicate your high-priority wish to the spirit
uvx haunted issue create "Implement user authentication" --priority high --description "Add login/logout functionality with JWT tokens"

# Organize supernatural work into phases
uvx haunted phase create "Phase 1 - Core Features" --description "Essential features for MVP"

# Channel additional requests into specific phases
uvx haunted issue create "Add password reset" --phase <phase-id> --priority medium
```

### 3. Release the Autonomous Spirit

```bash
# Unleash your spectral developer
uvx haunted start
```

Your ghostly assistant will:
- Scan for open Issues by supernatural priority
- Manifest Git branches for each spectral task
- Possess your codebase through the complete development cycle
- Automatically merge completed hauntings

### 4. Monitor Progress

```bash
# Check overall status
uvx haunted status

# List all issues
uvx haunted issue list

# View specific issue details
uvx haunted issue show <issue-id>

# View issues by status
uvx haunted issue list --status in_progress
```

## Workflow

Haunted implements the development workflow from `docs/DEVELOPMENT_WORKFLOW.md`:

1. **Plan**: AI analyzes requirements and creates implementation strategy
2. **Implement**: AI writes code following the plan
3. **Unit Test**: AI creates and runs unit tests
4. **Fix Issues**: AI fixes any test failures
5. **Integration Test**: AI runs integration tests
6. **Diagnose**: If integration tests fail, AI diagnoses and replans
7. **Done**: Issue completed and merged

## Commands

### Core Commands

- `uvx haunted init` - Initialize Haunted in current project
- `uvx haunted start` - Start the AI daemon
- `uvx haunted stop` - Stop the daemon
- `uvx haunted status` - Show current status

### Issue Management

- `uvx haunted issue create <title>` - Create new issue
- `uvx haunted issue list` - List all issues
- `uvx haunted issue show <id>` - Show issue details
- `uvx haunted issue comment <id> <message>` - Add comment to issue

### Phase Management

- `uvx haunted phase create <name>` - Create new phase
- `uvx haunted phase list` - List all phases

## Configuration

Configuration is stored in `.haunted/config.yaml`:

```yaml
api:
  # No API key needed! Uses Claude Code authentication
  model: claude-3-5-sonnet-20241022  # Claude Code model
  max_concurrent_issues: 3
  rate_limit_retry: true

daemon:
  scan_interval: 30  # seconds
  max_iterations: 3  # max workflow cycles per issue

git:
  auto_merge: true
  auto_commit: true

database:
  url: sqlite:///.haunted/haunted.db
```

## Architecture

```
haunted/
├── cli/           # Command-line interface
├── core/          # Core business logic
│   ├── claude_wrapper.py # Claude Code SDK integration
│   ├── workflow.py       # Workflow engine
│   ├── database.py       # Database management
│   └── git_manager.py    # Git operations
├── models/        # SQLModel data models
├── daemon/        # Background service
├── mcp/           # MCP tools for Claude
└── utils/         # Utilities and config
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

## MCP Tools

Claude has access to comprehensive tools:
- File operations (read, write, list)
- Command execution
- Git operations
- Issue management
- Code search and analysis

## Troubleshooting

### Common Issues

1. **Claude Code not authenticated**: Run `claude login` first
2. **Claude Code not installed**: Install with `npm install -g @anthropic-ai/claude-code`
3. **Python version < 3.10**: Upgrade to Python 3.10 or higher
4. **Not a Git repository**: Run `git init` first
5. **Database errors**: Delete `.haunted/haunted.db` and reinitialize

### Logs

Enable verbose logging:
```bash
uvx haunted --verbose start
```

Or specify log file:
```bash
uvx haunted --log-file haunted.log start
```

## Examples

### Basic Workflow

```bash
# Initialize project
uvx haunted init

# Create issues
uvx haunted issue create "Add user model" --priority high
uvx haunted issue create "Implement API endpoints" --priority high
uvx haunted issue create "Add input validation" --priority medium

# Start AI processing
uvx haunted start

# Monitor progress
watch uvx haunted status
```

### Issue Management

```bash
# View issue details
uvx haunted issue show abc123

# Add clarification comment
uvx haunted issue comment abc123 "Please use bcrypt for password hashing"

# Check all open issues
uvx haunted issue list --status open
```

## Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature/name`
3. Make changes and test
4. Submit pull request

## License

MIT License - see LICENSE file for details.
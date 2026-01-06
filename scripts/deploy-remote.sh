#!/bin/bash
# Haunted Remote Deployment Script
# Deploy haunted to a remote GPU server for smolGura

set -e

# Configuration
REMOTE_HOST="${REMOTE_HOST:-progcat@zenith.nb.fcuai}"
REMOTE_PATH="${REMOTE_PATH:-~/Desktop/haunted}"
SMOLGURA_PATH="${SMOLGURA_PATH:-~/Desktop/smolGura}"

echo "🏚️ Haunted Remote Deployment"
echo "=============================="
echo "Remote Host: $REMOTE_HOST"
echo "Remote Path: $REMOTE_PATH"
echo "smolGura Path: $SMOLGURA_PATH"
echo ""

# Check SSH connection
echo "📡 Checking SSH connection..."
if ! ssh -o BatchMode=yes -o ConnectTimeout=5 "$REMOTE_HOST" exit 2>/dev/null; then
    echo "❌ Cannot connect to $REMOTE_HOST"
    echo "Please ensure:"
    echo "  1. SSH key is set up: ssh-copy-id $REMOTE_HOST"
    echo "  2. Host is reachable"
    exit 1
fi
echo "✅ SSH connection OK"

# Check remote dependencies
echo ""
echo "🔍 Checking remote dependencies..."

ssh "$REMOTE_HOST" bash << 'REMOTE_CHECK'
set -e
echo "Checking Bun..."
if command -v bun &> /dev/null; then
    echo "✅ Bun $(bun --version)"
else
    echo "❌ Bun not found. Install with: curl -fsSL https://bun.sh/install | bash"
    exit 1
fi

echo "Checking GitHub CLI..."
if command -v gh &> /dev/null; then
    echo "✅ GitHub CLI $(gh --version | head -1)"
    if gh auth status &> /dev/null; then
        echo "✅ GitHub CLI authenticated"
    else
        echo "⚠️  GitHub CLI not authenticated. Run: gh auth login"
    fi
else
    echo "❌ GitHub CLI not found."
    exit 1
fi

echo "Checking Claude Code CLI..."
if command -v claude &> /dev/null; then
    echo "✅ Claude Code CLI found"
else
    echo "❌ Claude Code CLI not found. Install from: https://claude.com/claude-code"
    exit 1
fi
REMOTE_CHECK

echo ""
echo "📦 Deploying haunted to remote server..."

# Sync haunted to remote
rsync -avz --exclude 'node_modules' --exclude '.git' --exclude 'tmp' \
    ./ "$REMOTE_HOST:$REMOTE_PATH/"

echo ""
echo "📥 Installing dependencies on remote..."
ssh "$REMOTE_HOST" "cd $REMOTE_PATH && bun install"

echo ""
echo "🔧 Setting up smolGura repository..."
ssh "$REMOTE_HOST" bash << REMOTE_SETUP
set -e
cd $SMOLGURA_PATH 2>/dev/null || {
    echo "Cloning smolGura repository..."
    mkdir -p ~/Desktop
    cd ~/Desktop
    gh repo clone smolgura/smolGura || echo "Repository already exists or access denied"
}

# Ensure we're in the right directory
if [ -d "$SMOLGURA_PATH" ]; then
    cd $SMOLGURA_PATH
    echo "✅ smolGura directory ready: \$(pwd)"
    git fetch origin 2>/dev/null || true
else
    echo "⚠️  smolGura directory not found at $SMOLGURA_PATH"
fi
REMOTE_SETUP

echo ""
echo "=============================="
echo "✅ Deployment complete!"
echo ""
echo "Next steps:"
echo "  1. SSH to the server:"
echo "     ssh $REMOTE_HOST"
echo ""
echo "  2. Configure haunted.yaml if needed:"
echo "     cd $REMOTE_PATH && vim haunted.yaml"
echo ""
echo "  3. Start haunted:"
echo "     cd $REMOTE_PATH && bun run start"
echo ""
echo "  Or use screen/tmux for persistent session:"
echo "     screen -S haunted"
echo "     cd $REMOTE_PATH && bun run start"
echo ""

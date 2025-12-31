# Haunted - GitHub AI DevOps Tool
FROM oven/bun:1.2-alpine

# Install dependencies
RUN apk add --no-cache \
    git \
    github-cli \
    nodejs \
    npm

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Create app directory
WORKDIR /app

# Copy package files
COPY package.json bun.lock ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# Create directory for worktrees
RUN mkdir -p /tmp/haunted-worktrees

# Expose webhook port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start the application
CMD ["bun", "run", "start"]

#!/bin/bash
# Haunted - Standalone Docker Runner
# Usage: ./scripts/docker-run.sh [options]
#
# Environment variables:
#   REPO_PATH      - Path to the target repository (required)
#   CONFIG_PATH    - Path to haunted.yaml (default: ./haunted.yaml)
#   WEBHOOK_PORT   - Webhook port (default: 3000)
#   LOG_LEVEL      - Log level: debug, info, warn, error (default: info)
#   CONTAINER_NAME - Container name (default: haunted)

set -e

# Configuration
REPO_PATH="${REPO_PATH:-}"
CONFIG_PATH="${CONFIG_PATH:-./haunted.yaml}"
WEBHOOK_PORT="${WEBHOOK_PORT:-3000}"
LOG_LEVEL="${LOG_LEVEL:-info}"
CONTAINER_NAME="${CONTAINER_NAME:-haunted}"
IMAGE_NAME="${IMAGE_NAME:-haunted}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

print_usage() {
    echo "Usage: $0 [command]"
    echo ""
    echo "Commands:"
    echo "  start    Start haunted container (default)"
    echo "  stop     Stop haunted container"
    echo "  restart  Restart haunted container"
    echo "  logs     Show container logs"
    echo "  build    Build the Docker image"
    echo "  status   Show container status"
    echo ""
    echo "Environment variables:"
    echo "  REPO_PATH      Path to the target repository (required)"
    echo "  CONFIG_PATH    Path to haunted.yaml (default: ./haunted.yaml)"
    echo "  WEBHOOK_PORT   Webhook port (default: 3000)"
    echo "  LOG_LEVEL      Log level (default: info)"
    echo ""
    echo "Example:"
    echo "  REPO_PATH=/path/to/repo ./scripts/docker-run.sh start"
}

check_requirements() {
    if [ -z "$REPO_PATH" ]; then
        echo -e "${RED}Error: REPO_PATH is required${NC}"
        echo "Set it with: export REPO_PATH=/path/to/your/repo"
        exit 1
    fi

    if [ ! -d "$REPO_PATH" ]; then
        echo -e "${RED}Error: REPO_PATH does not exist: $REPO_PATH${NC}"
        exit 1
    fi

    if [ ! -f "$CONFIG_PATH" ]; then
        echo -e "${RED}Error: Config file not found: $CONFIG_PATH${NC}"
        echo "Create one from haunted.yaml.example or specify CONFIG_PATH"
        exit 1
    fi

    # Check for Claude and GitHub CLI auth
    if [ ! -d "$HOME/.claude" ]; then
        echo -e "${YELLOW}Warning: ~/.claude not found. Claude Code may not work.${NC}"
    fi

    if [ ! -d "$HOME/.config/gh" ]; then
        echo -e "${YELLOW}Warning: ~/.config/gh not found. Run 'gh auth login' first.${NC}"
    fi
}

build_image() {
    echo -e "${GREEN}Building haunted image...${NC}"
    docker build -t "$IMAGE_NAME" .
}

start_container() {
    check_requirements

    # Stop existing container if running
    if docker ps -q -f name="$CONTAINER_NAME" | grep -q .; then
        echo -e "${YELLOW}Container already running. Use 'restart' to restart.${NC}"
        exit 0
    fi

    # Remove stopped container if exists
    if docker ps -aq -f name="$CONTAINER_NAME" | grep -q .; then
        docker rm "$CONTAINER_NAME" > /dev/null
    fi

    echo -e "${GREEN}Starting haunted...${NC}"
    echo "  Repository: $REPO_PATH"
    echo "  Config: $CONFIG_PATH"
    echo "  Port: $WEBHOOK_PORT"

    docker run -d \
        --name "$CONTAINER_NAME" \
        --restart unless-stopped \
        -p "${WEBHOOK_PORT}:3000" \
        -v "$REPO_PATH:/repo:rw" \
        -v "$(realpath "$CONFIG_PATH"):/app/haunted.yaml:ro" \
        -v "$HOME/.claude:/root/.claude:ro" \
        -v "$HOME/.config/gh:/root/.config/gh:ro" \
        -v haunted-worktrees:/tmp/haunted-worktrees \
        -e REPO_PATH=/repo \
        -e LOG_LEVEL="$LOG_LEVEL" \
        -e NODE_ENV=production \
        "$IMAGE_NAME"

    echo -e "${GREEN}Haunted started!${NC}"
    echo "View logs: docker logs -f $CONTAINER_NAME"
}

stop_container() {
    if docker ps -q -f name="$CONTAINER_NAME" | grep -q .; then
        echo -e "${YELLOW}Stopping haunted...${NC}"
        docker stop "$CONTAINER_NAME"
        docker rm "$CONTAINER_NAME"
        echo -e "${GREEN}Stopped.${NC}"
    else
        echo "Container not running."
    fi
}

show_logs() {
    docker logs -f "$CONTAINER_NAME"
}

show_status() {
    if docker ps -q -f name="$CONTAINER_NAME" | grep -q .; then
        echo -e "${GREEN}Haunted is running${NC}"
        docker ps -f name="$CONTAINER_NAME" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    else
        echo -e "${YELLOW}Haunted is not running${NC}"
    fi
}

# Main
COMMAND="${1:-start}"

case "$COMMAND" in
    start)
        start_container
        ;;
    stop)
        stop_container
        ;;
    restart)
        stop_container
        start_container
        ;;
    logs)
        show_logs
        ;;
    build)
        build_image
        ;;
    status)
        show_status
        ;;
    help|--help|-h)
        print_usage
        ;;
    *)
        echo -e "${RED}Unknown command: $COMMAND${NC}"
        print_usage
        exit 1
        ;;
esac

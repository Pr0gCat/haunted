"""Core functionality package for Haunted."""

from haunted.core.workflow import WorkflowEngine
from haunted.core.database import DatabaseManager
from haunted.core.git_manager import GitManager
from haunted.core.claude_wrapper import ClaudeCodeWrapper

__all__ = ["WorkflowEngine", "DatabaseManager", "GitManager", "ClaudeCodeWrapper"]

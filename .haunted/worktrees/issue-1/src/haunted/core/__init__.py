"""Core functionality package for Haunted."""

# from .agent import ClaudeAgent  # 暫時註解掉，等待更新
from .workflow import WorkflowEngine
from .database import DatabaseManager
from .git_manager import GitManager
from .claude_wrapper import ClaudeCodeWrapper

__all__ = ["WorkflowEngine", "DatabaseManager", "GitManager", "ClaudeCodeWrapper"]
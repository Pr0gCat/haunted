"""MCP tools for Claude to interact with Haunted."""

import os
import subprocess
import json
from typing import Dict, Any, List, Optional
from pathlib import Path

from ..core.database import DatabaseManager
from ..core.git_manager import GitManager
from ..models import Issue, Task, Comment
from ..utils.logger import get_logger

logger = get_logger(__name__)


class MCPToolHandler:
    """Handles MCP tool calls from Claude."""
    
    def __init__(self, db_manager: DatabaseManager, git_manager: GitManager, 
                 project_root: str = "."):
        """
        Initialize MCP tool handler.
        
        Args:
            db_manager: Database manager instance
            git_manager: Git manager instance  
            project_root: Project root directory
        """
        self.db = db_manager
        self.git = git_manager
        self.project_root = Path(project_root)
        
        # Map tool names to handler methods
        self.tools = {
            "read_file": self.read_file,
            "write_file": self.write_file,
            "run_command": self.run_command,
            "git_operation": self.git_operation,
            "get_issue_context": self.get_issue_context,
            "update_issue_status": self.update_issue_status,
            "create_task": self.create_task,
            "add_comment": self.add_comment,
            "list_files": self.list_files,
            "search_code": self.search_code,
        }
    
    async def handle_tool_call(self, tool_name: str, parameters: Dict[str, Any]) -> Dict[str, Any]:
        """
        Handle a tool call from Claude.
        
        Args:
            tool_name: Name of the tool to call
            parameters: Tool parameters
            
        Returns:
            Tool execution result
        """
        try:
            if tool_name not in self.tools:
                return {
                    "success": False,
                    "error": f"Unknown tool: {tool_name}",
                    "available_tools": list(self.tools.keys())
                }
            
            handler = self.tools[tool_name]
            result = await handler(**parameters)
            
            logger.debug(f"Tool {tool_name} executed successfully")
            return {"success": True, "result": result}
            
        except Exception as e:
            logger.error(f"Tool {tool_name} failed: {e}")
            return {"success": False, "error": str(e)}
    
    # File operations
    async def read_file(self, path: str) -> str:
        """
        Read file contents.
        
        Args:
            path: File path (relative to project root)
            
        Returns:
            File contents
        """
        file_path = self.project_root / path
        
        if not file_path.exists():
            raise FileNotFoundError(f"File not found: {path}")
        
        if file_path.is_dir():
            raise IsADirectoryError(f"Path is a directory: {path}")
        
        # Check file size (limit to 1MB)
        if file_path.stat().st_size > 1024 * 1024:
            raise ValueError(f"File too large: {path}")
        
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                return f.read()
        except UnicodeDecodeError:
            # Try reading as binary if UTF-8 fails
            with open(file_path, 'rb') as f:
                content = f.read()
                return f"[Binary file, {len(content)} bytes]"
    
    async def write_file(self, path: str, content: str) -> str:
        """
        Write content to file.
        
        Args:
            path: File path (relative to project root)
            content: File content
            
        Returns:
            Success message
        """
        file_path = self.project_root / path
        
        # Create parent directories if needed
        file_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Write file
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(content)
        
        logger.info(f"Written file: {path}")
        return f"File written successfully: {path}"
    
    async def list_files(self, path: str = ".", pattern: str = "*") -> List[str]:
        """
        List files in directory.
        
        Args:
            path: Directory path
            pattern: Glob pattern
            
        Returns:
            List of file paths
        """
        dir_path = self.project_root / path
        
        if not dir_path.exists() or not dir_path.is_dir():
            raise NotADirectoryError(f"Directory not found: {path}")
        
        files = []
        for file_path in dir_path.glob(pattern):
            if file_path.is_file():
                relative_path = file_path.relative_to(self.project_root)
                files.append(str(relative_path))
        
        return sorted(files)
    
    # Command execution
    async def run_command(self, command: str, cwd: Optional[str] = None) -> Dict[str, Any]:
        """
        Run shell command.
        
        Args:
            command: Command to execute
            cwd: Working directory (defaults to project root)
            
        Returns:
            Command result with stdout, stderr, and return code
        """
        if cwd:
            work_dir = self.project_root / cwd
        else:
            work_dir = self.project_root
        
        try:
            result = subprocess.run(
                command,
                shell=True,
                cwd=work_dir,
                capture_output=True,
                text=True,
                timeout=60  # 1 minute timeout
            )
            
            return {
                "stdout": result.stdout,
                "stderr": result.stderr,
                "return_code": result.returncode,
                "command": command,
                "cwd": str(work_dir)
            }
            
        except subprocess.TimeoutExpired:
            return {
                "stdout": "",
                "stderr": "Command timed out after 60 seconds",
                "return_code": -1,
                "command": command,
                "cwd": str(work_dir)
            }
    
    # Git operations
    async def git_operation(self, operation: str, args: List[str] = None) -> Dict[str, Any]:
        """
        Perform Git operations.
        
        Args:
            operation: Git operation (add, commit, status, etc.)
            args: Additional arguments
            
        Returns:
            Operation result
        """
        if args is None:
            args = []
        
        try:
            if operation == "status":
                status = self.git.get_repository_status()
                return status
            
            elif operation == "add":
                if not args:
                    args = ["."]
                command = f"git add {' '.join(args)}"
                return await self.run_command(command)
            
            elif operation == "commit":
                if not args:
                    raise ValueError("Commit message required")
                message = args[0]
                commit_hash = self.git.commit_changes(message)
                return {"commit_hash": commit_hash, "message": message}
            
            elif operation == "branch":
                if args:
                    branch_name = args[0]
                    self.git.create_branch(branch_name)
                    return {"created_branch": branch_name}
                else:
                    current = self.git.get_current_branch()
                    return {"current_branch": current}
            
            elif operation == "checkout":
                if not args:
                    raise ValueError("Branch name required")
                branch_name = args[0]
                self.git.checkout_branch(branch_name)
                return {"checked_out": branch_name}
            
            else:
                # Generic git command
                command = f"git {operation} {' '.join(args)}"
                return await self.run_command(command)
                
        except Exception as e:
            return {"error": str(e)}
    
    # Database operations
    async def get_issue_context(self, issue_id: str) -> Dict[str, Any]:
        """
        Get complete issue context.
        
        Args:
            issue_id: Issue ID
            
        Returns:
            Issue context including tasks, comments, etc.
        """
        issue = await self.db.get_issue(issue_id)
        if not issue:
            raise ValueError(f"Issue not found: {issue_id}")
        
        # Get related data
        tasks = await self.db.get_tasks(issue_id)
        comments = await self.db.get_comments(issue_id)
        test_results = await self.db.get_test_results(issue_id)
        
        return {
            "issue": {
                "id": issue.id,
                "title": issue.title,
                "description": issue.description,
                "priority": issue.priority,
                "status": issue.status,
                "workflow_stage": issue.workflow_stage,
                "branch_name": issue.branch_name,
                "plan": issue.plan,
                "diagnosis_log": issue.diagnosis_log,
                "iteration_count": issue.iteration_count,
            },
            "tasks": [
                {
                    "id": task.id,
                    "description": task.description,
                    "status": task.status,
                    "commit_hash": task.commit_hash,
                }
                for task in tasks
            ],
            "comments": [
                {
                    "author": comment.author,
                    "content": comment.content,
                    "created_at": comment.created_at.isoformat(),
                }
                for comment in comments
            ],
            "test_results": [
                {
                    "test_type": result.test_type,
                    "status": result.status,
                    "error_log": result.error_log,
                    "timestamp": result.timestamp.isoformat(),
                }
                for result in test_results
            ]
        }
    
    async def update_issue_status(self, issue_id: str, status: str, 
                                 workflow_stage: Optional[str] = None) -> str:
        """
        Update issue status and workflow stage.
        
        Args:
            issue_id: Issue ID
            status: New status
            workflow_stage: Optional new workflow stage
            
        Returns:
            Success message
        """
        issue = await self.db.get_issue(issue_id)
        if not issue:
            raise ValueError(f"Issue not found: {issue_id}")
        
        issue.status = status
        if workflow_stage:
            issue.workflow_stage = workflow_stage
        
        await self.db.update_issue(issue)
        
        return f"Issue {issue_id} updated: status={status}, stage={workflow_stage}"
    
    async def create_task(self, issue_id: str, description: str) -> str:
        """
        Create a new task for an issue.
        
        Args:
            issue_id: Issue ID
            description: Task description
            
        Returns:
            Task ID
        """
        import time
        from ..models import TaskStatus
        
        task = Task(
            id=f"{issue_id}-task-{int(time.time())}",  # Use issue ID and timestamp
            issue_id=issue_id,
            description=description,
            status=TaskStatus.PENDING
        )
        
        created_task = await self.db.create_task(task)
        return created_task.id
    
    async def add_comment(self, issue_id: str, content: str, author: str = "ai") -> str:
        """
        Add comment to issue.
        
        Args:
            issue_id: Issue ID
            content: Comment content
            author: Comment author
            
        Returns:
            Comment ID
        """
        comment = await self.db.add_comment(issue_id, author, content)
        return comment.id
    
    # Code search and analysis
    async def search_code(self, pattern: str, file_pattern: str = "*.py") -> List[Dict[str, Any]]:
        """
        Search for code patterns in files.
        
        Args:
            pattern: Search pattern (regex)
            file_pattern: File glob pattern
            
        Returns:
            List of matches with file, line number, and content
        """
        import re
        
        matches = []
        
        for file_path in self.project_root.glob(f"**/{file_pattern}"):
            if not file_path.is_file():
                continue
            
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    lines = f.readlines()
                
                for line_num, line in enumerate(lines, 1):
                    if re.search(pattern, line):
                        relative_path = file_path.relative_to(self.project_root)
                        matches.append({
                            "file": str(relative_path),
                            "line": line_num,
                            "content": line.strip(),
                            "match": pattern
                        })
                        
            except (UnicodeDecodeError, PermissionError):
                # Skip files that can't be read
                continue
        
        return matches[:50]  # Limit to 50 matches
    
    @classmethod
    def get_tool_definitions(cls) -> List[Dict[str, Any]]:
        """
        Get MCP tool definitions for Claude.
        
        Returns:
            List of tool definitions
        """
        return [
            {
                "name": "read_file",
                "description": "Read contents of a file",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "File path relative to project root"}
                    },
                    "required": ["path"]
                }
            },
            {
                "name": "write_file",
                "description": "Write content to a file",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "File path relative to project root"},
                        "content": {"type": "string", "description": "File content to write"}
                    },
                    "required": ["path", "content"]
                }
            },
            {
                "name": "list_files",
                "description": "List files in a directory",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "Directory path", "default": "."},
                        "pattern": {"type": "string", "description": "Glob pattern", "default": "*"}
                    }
                }
            },
            {
                "name": "run_command",
                "description": "Execute a shell command",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "command": {"type": "string", "description": "Command to execute"},
                        "cwd": {"type": "string", "description": "Working directory"}
                    },
                    "required": ["command"]
                }
            },
            {
                "name": "git_operation",
                "description": "Perform Git operations",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "operation": {"type": "string", "description": "Git operation (status, add, commit, etc.)"},
                        "args": {"type": "array", "items": {"type": "string"}, "description": "Operation arguments"}
                    },
                    "required": ["operation"]
                }
            },
            {
                "name": "get_issue_context",
                "description": "Get complete context for an issue",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "issue_id": {"type": "string", "description": "Issue ID"}
                    },
                    "required": ["issue_id"]
                }
            },
            {
                "name": "update_issue_status",
                "description": "Update issue status and workflow stage",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "issue_id": {"type": "string", "description": "Issue ID"},
                        "status": {"type": "string", "description": "New status"},
                        "workflow_stage": {"type": "string", "description": "New workflow stage"}
                    },
                    "required": ["issue_id", "status"]
                }
            },
            {
                "name": "create_task",
                "description": "Create a new task for an issue",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "issue_id": {"type": "string", "description": "Issue ID"},
                        "description": {"type": "string", "description": "Task description"}
                    },
                    "required": ["issue_id", "description"]
                }
            },
            {
                "name": "add_comment",
                "description": "Add a comment to an issue",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "issue_id": {"type": "string", "description": "Issue ID"},
                        "content": {"type": "string", "description": "Comment content"},
                        "author": {"type": "string", "description": "Comment author", "default": "ai"}
                    },
                    "required": ["issue_id", "content"]
                }
            },
            {
                "name": "search_code",
                "description": "Search for patterns in code files",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "pattern": {"type": "string", "description": "Search pattern (regex)"},
                        "file_pattern": {"type": "string", "description": "File pattern", "default": "*.py"}
                    },
                    "required": ["pattern"]
                }
            }
        ]
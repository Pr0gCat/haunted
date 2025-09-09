"""Database management for Haunted."""

import uuid
from datetime import datetime
from typing import List, Optional, AsyncGenerator
from contextlib import asynccontextmanager
from sqlmodel import SQLModel, create_engine, Session, select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, create_async_engine
from sqlalchemy.pool import StaticPool

from ..models import Issue, Task, Phase, Comment, TestResult, TestType, IssueStatus, WorkflowStage
from ..utils.logger import get_logger

logger = get_logger(__name__)

# Global counter for issue IDs
_issue_counter = 0


class DatabaseManager:
    """Manages database operations for Haunted."""
    
    def __init__(self, database_url: str = "sqlite:////.haunted/haunted.db"):
        """
        Initialize database manager.
        
        Args:
            database_url: Database connection URL
        """
        self.database_url = database_url
        
        # Create async engine for SQLite
        if database_url.startswith("sqlite"):
            # Convert to async SQLite URL
            if ":///" in database_url:
                async_url = database_url.replace("sqlite:///", "sqlite+aiosqlite:///")
            else:
                async_url = database_url.replace("sqlite://", "sqlite+aiosqlite://")
            
            self.engine = create_async_engine(
                async_url,
                poolclass=StaticPool,
                connect_args={
                    "check_same_thread": False,
                    "timeout": 30
                },
                echo=False
            )
        else:
            self.engine = create_async_engine(database_url)
        
        logger.info(f"Database initialized: {database_url}")
    
    async def create_tables(self):
        """Create all database tables."""
        async with self.engine.begin() as conn:
            await conn.run_sync(SQLModel.metadata.create_all)
        logger.info("Database tables created")
    
    @asynccontextmanager
    async def get_session(self) -> AsyncGenerator[AsyncSession, None]:
        """Get database session context manager."""
        async with AsyncSession(self.engine) as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise
    
    # Phase operations
    async def create_phase(self, name: str, description: Optional[str] = None) -> dict:
        """
        Create a new phase.
        
        Args:
            name: Phase name
            description: Optional description
            
        Returns:
            Created phase as dictionary
        """
        phase_id = str(uuid.uuid4())
        branch_name = f"phase/{name.lower().replace(' ', '-')}"
        
        phase = Phase(
            id=phase_id,
            name=name,
            description=description,
            branch_name=branch_name
        )
        
        async with self.get_session() as session:
            session.add(phase)
        
        logger.info(f"Created phase: {name}")
        
        # Return as dictionary to avoid session issues
        return {
            'id': phase_id,
            'name': name,
            'description': description,
            'branch_name': branch_name,
            'status': 'PLANNING',  # Default status
            'created_at': datetime.now(),
            'updated_at': datetime.now()
        }
    
    async def get_phase(self, phase_id: str) -> Optional[Phase]:
        """Get phase by ID."""
        async with self.get_session() as session:
            return await session.get(Phase, phase_id)
    
    async def list_phases(self) -> List[dict]:
        """List all phases as dictionaries."""
        from sqlalchemy import text
        async with self.get_session() as session:
            # Use raw SQL to avoid session binding issues
            result = await session.execute(
                text("SELECT id, name, description, status, branch_name, created_at, updated_at FROM phases")
            )
            phase_list = []
            for row in result:
                phase_dict = {
                    'id': row.id,
                    'name': row.name,
                    'description': row.description,
                    'status': row.status,
                    'branch_name': row.branch_name,
                    'created_at': row.created_at,
                    'updated_at': row.updated_at
                }
                phase_list.append(phase_dict)
            return phase_list
    
    # Issue operations
    async def create_issue(self, title: str, description: str, 
                          priority: str = "medium", phase_id: Optional[str] = None) -> dict:
        """
        Create a new issue.
        
        Args:
            title: Issue title
            description: Issue description  
            priority: Issue priority
            phase_id: Optional phase ID
            
        Returns:
            Created issue as dictionary
        """
        # Get next available issue number from database
        async with self.get_session() as session:
            # Get count of existing issues to determine next number
            result = await session.execute(select(Issue))
            existing_issues = result.scalars().all()
            next_number = len(existing_issues) + 1
        
        issue_id = str(next_number)
        branch_name = f"issue/{issue_id}"
        
        issue = Issue(
            id=issue_id,
            title=title,
            description=description,
            priority=priority,
            phase_id=phase_id,
            branch_name=branch_name
        )
        
        async with self.get_session() as session:
            session.add(issue)
        
        logger.info(f"Created issue: {title}")
        
        # Return as dictionary to avoid session issues
        return {
            'id': issue_id,
            'title': title,
            'description': description,
            'priority': priority,
            'phase_id': phase_id,
            'branch_name': branch_name,
            'status': 'OPEN',  # Default status
            'workflow_stage': 'PLAN',  # Default stage
            'created_at': datetime.now(),
            'updated_at': datetime.now()
        }
    
    async def get_issue(self, issue_id: str) -> Optional[Issue]:
        """Get issue by ID."""
        async with self.get_session() as session:
            return await session.get(Issue, issue_id)
    
    async def update_issue(self, issue: Issue) -> Issue:
        """Update existing issue."""
        issue.updated_at = datetime.now()
        
        async with self.get_session() as session:
            session.add(issue)
        
        return issue
    
    async def list_issues(self, status: Optional[IssueStatus] = None, 
                         phase_id: Optional[str] = None) -> List[dict]:
        """
        List issues with optional filters.
        
        Args:
            status: Optional status filter
            phase_id: Optional phase filter
            
        Returns:
            List of issues
        """
        from sqlalchemy import text
        async with self.get_session() as session:
            # Use raw SQL to avoid session binding issues
            sql = "SELECT id, title, description, priority, status, workflow_stage, phase_id, branch_name, created_at, updated_at FROM issues"
            
            conditions = []
            params = {}
            
            if status:
                conditions.append("status = :status")
                params['status'] = status
            if phase_id:
                conditions.append("phase_id = :phase_id")  
                params['phase_id'] = phase_id
                
            if conditions:
                sql += " WHERE " + " AND ".join(conditions)
                
            sql += " ORDER BY priority DESC, created_at ASC"
            
            result = await session.execute(text(sql), params)
            
            issue_list = []
            for row in result:
                issue_dict = {
                    'id': row.id,
                    'title': row.title,
                    'description': row.description,
                    'priority': row.priority,
                    'status': row.status,
                    'workflow_stage': row.workflow_stage,
                    'phase_id': row.phase_id,
                    'branch_name': row.branch_name,
                    'created_at': row.created_at,
                    'updated_at': row.updated_at
                }
                issue_list.append(issue_dict)
            return issue_list
    
    async def get_open_issues_by_priority(self) -> List[Issue]:
        """Get open issues ordered by priority."""
        return await self.list_issues(status=IssueStatus.OPEN)
    
    # Task operations
    async def create_task(self, task: Task) -> Task:
        """Create a new task."""
        async with self.get_session() as session:
            session.add(task)
        
        logger.info(f"Created task for issue {task.issue_id}")
        return task
    
    async def get_tasks(self, issue_id: str) -> List[Task]:
        """Get all tasks for an issue."""
        async with self.get_session() as session:
            stmt = select(Task).where(Task.issue_id == issue_id)
            result = await session.execute(stmt)
            return result.scalars().all()
    
    async def update_task(self, task: Task) -> Task:
        """Update existing task."""
        async with self.get_session() as session:
            session.add(task)
        
        return task
    
    # Comment operations  
    async def add_comment(self, issue_id: str, author: str, content: str) -> Comment:
        """Add comment to issue."""
        comment = Comment(
            id=str(_issue_counter + 1),  # Simple incremental ID for comments too
            issue_id=issue_id,
            author=author,
            content=content
        )
        
        async with self.get_session() as session:
            session.add(comment)
        
        logger.info(f"Added comment to issue {issue_id}")
        return comment
    
    async def get_comments(self, issue_id: str) -> List[Comment]:
        """Get all comments for an issue."""
        async with self.get_session() as session:
            stmt = select(Comment).where(Comment.issue_id == issue_id).order_by(Comment.created_at)
            result = await session.execute(stmt)
            return result.scalars().all()
    
    # Test result operations
    async def create_test_result(self, test_result: TestResult) -> TestResult:
        """Create test result record."""
        async with self.get_session() as session:
            session.add(test_result)
        
        logger.info(f"Recorded test result for issue {test_result.issue_id}")
        return test_result
    
    async def get_test_results(self, issue_id: str, 
                              test_type: Optional[TestType] = None) -> List[TestResult]:
        """
        Get test results for an issue.
        
        Args:
            issue_id: Issue ID
            test_type: Optional test type filter
            
        Returns:
            List of test results
        """
        async with self.get_session() as session:
            stmt = select(TestResult).where(TestResult.issue_id == issue_id)
            
            if test_type:
                stmt = stmt.where(TestResult.test_type == test_type)
            
            stmt = stmt.order_by(TestResult.timestamp.desc())
            
            result = await session.execute(stmt)
            return result.scalars().all()
    
    # Statistics and queries
    async def get_issue_stats(self) -> dict:
        """Get issue statistics."""
        async with self.get_session() as session:
            # Count by status
            stats = {}
            for status in IssueStatus:
                stmt = select(Issue).where(Issue.status == status)
                result = await session.execute(stmt)
                stats[status.value] = len(result.scalars().all())
            
            # Count by workflow stage
            workflow_stats = {}
            for stage in WorkflowStage:
                stmt = select(Issue).where(Issue.workflow_stage == stage)
                result = await session.execute(stmt)
                workflow_stats[stage.value] = len(result.scalars().all())
            
            stats["workflow_stages"] = workflow_stats
            
        return stats
    
    async def close(self):
        """Close database connection."""
        await self.engine.dispose()
        logger.info("Database connection closed")
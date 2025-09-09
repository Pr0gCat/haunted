"""Task model for subtasks within issues."""

from datetime import datetime
from typing import Optional
from sqlmodel import SQLModel, Field, Relationship

from .base import TaskStatus


class Task(SQLModel, table=True):
    """Represents a subtask within an issue."""
    
    __tablename__ = "tasks"
    
    id: str = Field(primary_key=True)
    issue_id: str = Field(foreign_key="issues.id", index=True)
    description: str
    status: TaskStatus = Field(default=TaskStatus.PENDING)
    commit_hash: Optional[str] = None
    error_log: Optional[str] = None
    
    # Timestamps
    created_at: datetime = Field(default_factory=datetime.now)
    completed_at: Optional[datetime] = None
    
    # Relationships (commented out to avoid session issues)
    # issue: "Issue" = Relationship(back_populates="tasks")
    
    class Config:
        arbitrary_types_allowed = True
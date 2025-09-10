"""Issue model for task management."""

from datetime import datetime
from typing import Optional, List, TYPE_CHECKING
from sqlmodel import SQLModel, Field, Relationship

if TYPE_CHECKING:
    from .phase import Phase
    from .task import Task
    from .comment import Comment
    from .test_result import TestResult

from .base import Priority, IssueStatus, WorkflowStage


class Issue(SQLModel, table=True):
    """Represents an issue/task to be processed by AI."""
    
    __tablename__ = "issues"
    
    id: str = Field(primary_key=True)
    title: str = Field(index=True)
    description: str
    priority: Priority = Field(default=Priority.MEDIUM)
    status: IssueStatus = Field(default=IssueStatus.OPEN, index=True)
    workflow_stage: WorkflowStage = Field(default=WorkflowStage.PLAN)
    
    # Phase relationship
    phase_id: Optional[str] = Field(default=None, foreign_key="phases.id")
    # phase: Optional["Phase"] = Relationship(back_populates="issues")  # Commented out to avoid session issues
    
    # Git integration
    branch_name: str = Field(unique=True)
    
    # Workflow tracking
    plan: Optional[str] = None
    diagnosis_log: Optional[str] = None
    iteration_count: int = Field(default=0)
    
    # Timestamps
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)
    
    # Relationships (commented out for now to avoid session issues)
    # tasks: List["Task"] = Relationship(back_populates="issue")
    # comments: List["Comment"] = Relationship(back_populates="issue") 
    # test_results: List["TestResult"] = Relationship(back_populates="issue")
    
    class Config:
        arbitrary_types_allowed = True
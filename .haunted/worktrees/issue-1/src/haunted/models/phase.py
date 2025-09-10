"""Phase model for project phases management."""

from datetime import datetime
from typing import Optional, List, TYPE_CHECKING
from sqlmodel import SQLModel, Field, Relationship

if TYPE_CHECKING:
    from .issue import Issue

from .base import PhaseStatus


class Phase(SQLModel, table=True):
    """Represents a project phase."""
    
    __tablename__ = "phases"
    
    id: str = Field(primary_key=True)
    name: str = Field(index=True)
    description: Optional[str] = None
    status: PhaseStatus = Field(default=PhaseStatus.PLANNING)
    branch_name: str = Field(unique=True)
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)
    
    # Relationships (commented out for now to avoid session issues)
    # issues: List["Issue"] = Relationship(back_populates="phase")
    
    class Config:
        arbitrary_types_allowed = True
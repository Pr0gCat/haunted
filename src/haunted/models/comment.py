"""Comment model for issue communication."""

from datetime import datetime
from typing import Optional
from sqlmodel import SQLModel, Field


class Comment(SQLModel, table=True):
    """Represents a comment on an issue."""

    __tablename__ = "comments"

    id: Optional[int] = Field(default=None, primary_key=True)
    issue_id: int = Field(foreign_key="issues.id", index=True)
    author: str  # "user" or "ai"
    content: str
    created_at: datetime = Field(default_factory=datetime.now)

    # Relationships (commented out to avoid session issues)
    # issue: "Issue" = Relationship(back_populates="comments")

    class Config:
        arbitrary_types_allowed = True

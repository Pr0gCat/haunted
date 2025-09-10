"""Test result model for tracking test outcomes."""

from datetime import datetime
from typing import Optional
from sqlmodel import SQLModel, Field, Relationship
from enum import Enum


class TestType(str, Enum):
    """Types of tests."""
    UNIT = "unit"
    INTEGRATION = "integration"


class TestStatus(str, Enum):
    """Test result status."""
    PASSED = "passed"
    FAILED = "failed"
    SKIPPED = "skipped"


class TestResult(SQLModel, table=True):
    """Represents a test execution result."""
    
    __tablename__ = "test_results"
    
    id: str = Field(primary_key=True)
    issue_id: str = Field(foreign_key="issues.id", index=True)
    test_type: TestType
    status: TestStatus
    test_name: Optional[str] = None
    error_log: Optional[str] = None
    output: Optional[str] = None
    duration_seconds: Optional[float] = None
    timestamp: datetime = Field(default_factory=datetime.now)
    
    # Relationships (commented out to avoid session issues)
    # issue: "Issue" = Relationship(back_populates="test_results")
    
    class Config:
        arbitrary_types_allowed = True
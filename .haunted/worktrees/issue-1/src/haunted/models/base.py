"""Base models and enums for Haunted."""

from enum import Enum
from datetime import datetime
from typing import Optional
from sqlmodel import SQLModel, Field


class Priority(str, Enum):
    """Issue priority levels."""
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class IssueStatus(str, Enum):
    """Issue status."""
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    BLOCKED = "blocked"
    CLOSED = "closed"


class WorkflowStage(str, Enum):
    """Workflow stages based on DEVELOPMENT_WORKFLOW.md."""
    PLAN = "plan"
    IMPLEMENT = "implement"
    UNIT_TEST = "unit_test"
    FIX_ISSUES = "fix_issues"
    INTEGRATION_TEST = "integration_test"
    DIAGNOSE = "diagnose"
    DONE = "done"


class PhaseStatus(str, Enum):
    """Phase status."""
    PLANNING = "planning"
    ACTIVE = "active"
    COMPLETED = "completed"
    ARCHIVED = "archived"


class TaskStatus(str, Enum):
    """Task status."""
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
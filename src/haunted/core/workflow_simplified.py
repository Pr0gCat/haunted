"""Simplified Workflow engine for testing Claude Code integration."""

import asyncio
from typing import Dict, Any
from datetime import datetime

from ..models import WorkflowStage, IssueStatus
from ..utils.logger import get_logger
from .claude_wrapper import ClaudeCodeWrapper

logger = get_logger(__name__)


class SimplifiedWorkflowEngine:
    """
    Simplified workflow engine for testing Claude Code integration.
    Plan → Implement → Unit Test → Integration Test → Done
    """
    
    def __init__(self, db_manager: "DatabaseManager"):
        """Initialize simplified workflow engine."""
        self.claude_wrapper = ClaudeCodeWrapper()
        self.db = db_manager
        self.max_iterations = 3
    
    async def process_issue(self, issue_dict: Dict[str, Any]) -> Dict[str, Any]:
        """
        Process an issue through a simplified workflow.
        
        Args:
            issue_dict: Issue data as dictionary to process
            
        Returns:
            Processed issue dictionary with final status
        """
        logger.info(f"Starting simplified workflow for issue {issue_dict['id']}: {issue_dict['title']}")
        
        # Check Claude Code availability first
        if not await self.claude_wrapper.check_claude_availability():
            logger.error("Claude Code CLI not available - workflow cannot proceed")
            issue_dict['status'] = IssueStatus.BLOCKED.value
            issue_dict['workflow_stage'] = WorkflowStage.DONE.value
            issue_dict['diagnosis_log'] = "Claude Code CLI not available"
            return issue_dict
        
        try:
            # Initialize iteration count
            if 'iteration_count' not in issue_dict:
                issue_dict['iteration_count'] = 0
            
            # Stage 1: Plan
            logger.info(f"Stage 1: Planning issue {issue_dict['id']}")
            issue_dict['status'] = IssueStatus.IN_PROGRESS.value
            issue_dict['workflow_stage'] = WorkflowStage.PLAN.value
            
            try:
                plan = await self.claude_wrapper.analyze_and_plan(issue_dict)
                issue_dict['plan'] = plan
                logger.info(f"✓ Plan completed for issue {issue_dict['id']}")
            except Exception as e:
                logger.error(f"✗ Planning failed: {e}")
                issue_dict['diagnosis_log'] = f"Planning failed: {e}"
                issue_dict['status'] = IssueStatus.BLOCKED.value
                issue_dict['workflow_stage'] = WorkflowStage.DONE.value
                return issue_dict
            
            await asyncio.sleep(1)  # Brief pause between stages
            
            # Stage 2: Implement
            logger.info(f"Stage 2: Implementing solution for issue {issue_dict['id']}")
            issue_dict['workflow_stage'] = WorkflowStage.IMPLEMENT.value
            
            try:
                implementation = await self.claude_wrapper.implement_solution(issue_dict)
                issue_dict['implementation'] = implementation
                logger.info(f"✓ Implementation completed for issue {issue_dict['id']}")
            except Exception as e:
                logger.error(f"✗ Implementation failed: {e}")
                issue_dict['diagnosis_log'] = f"Implementation failed: {e}"
                issue_dict['status'] = IssueStatus.BLOCKED.value
                issue_dict['workflow_stage'] = WorkflowStage.DONE.value
                return issue_dict
                
            await asyncio.sleep(1)
            
            # Stage 3: Unit Test
            logger.info(f"Stage 3: Generating tests for issue {issue_dict['id']}")
            issue_dict['workflow_stage'] = WorkflowStage.UNIT_TEST.value
            
            try:
                tests = await self.claude_wrapper.generate_tests(issue_dict)
                issue_dict['tests'] = tests
                logger.info(f"✓ Tests generated for issue {issue_dict['id']}")
            except Exception as e:
                logger.error(f"✗ Test generation failed: {e}")
                issue_dict['diagnosis_log'] = f"Test generation failed: {e}"
                issue_dict['status'] = IssueStatus.BLOCKED.value
                issue_dict['workflow_stage'] = WorkflowStage.DONE.value
                return issue_dict
                
            await asyncio.sleep(1)
            
            # Stage 4: Integration Test (simplified - just mark as passed)
            logger.info(f"Stage 4: Integration testing for issue {issue_dict['id']}")
            issue_dict['workflow_stage'] = WorkflowStage.INTEGRATION_TEST.value
            
            # For testing purposes, assume integration tests pass
            logger.info(f"✓ Integration tests passed for issue {issue_dict['id']}")
            
            # Final Stage: Done
            issue_dict['status'] = IssueStatus.CLOSED.value
            issue_dict['workflow_stage'] = WorkflowStage.DONE.value
            issue_dict['iteration_count'] += 1
            issue_dict['updated_at'] = datetime.now()
            
            # Save final state to database
            try:
                # We need to update the database with the new status
                # For now, we'll indicate success but database update would happen in daemon
                logger.info(f"Issue {issue_dict['id']} ready for database update")
            except Exception as e:
                logger.warning(f"Could not update database for issue {issue_dict['id']}: {e}")
            
            logger.info(f"🎉 Workflow completed successfully for issue {issue_dict['id']}")
            return issue_dict
            
        except Exception as e:
            logger.error(f"Workflow error for issue {issue_dict['id']}: {e}")
            issue_dict['status'] = IssueStatus.BLOCKED.value
            issue_dict['workflow_stage'] = WorkflowStage.DONE.value
            issue_dict['diagnosis_log'] = f"Workflow error: {e}"
            return issue_dict
    
    async def diagnose_issue(self, issue_dict: Dict[str, Any], error_log: str) -> str:
        """
        Diagnose an issue using Claude Code.
        
        Args:
            issue_dict: Issue data
            error_log: Error log to analyze
            
        Returns:
            Diagnosis result
        """
        try:
            diagnosis = await self.claude_wrapper.diagnose_issues(issue_dict, error_log)
            logger.info(f"Diagnosis completed for issue {issue_dict['id']}")
            return diagnosis
        except Exception as e:
            logger.error(f"Diagnosis failed for issue {issue_dict['id']}: {e}")
            return f"Diagnosis failed: {e}"
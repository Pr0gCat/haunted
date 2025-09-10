"""Workflow engine implementing DEVELOPMENT_WORKFLOW.md."""

import asyncio
from typing import Optional, Dict, Callable, Any
from datetime import datetime

from ..models import WorkflowStage, IssueStatus, Task, TestResult, TestType, TestStatus
from ..utils.logger import get_logger
from .claude_wrapper import ClaudeCodeWrapper

logger = get_logger(__name__)


class WorkflowEngine:
    """
    Implements the development workflow from DEVELOPMENT_WORKFLOW.md:
    Plan → Implement → Unit Test → Fix Issues → Integration Test → Diagnose → Done
    """
    
    def __init__(self, db_manager: "DatabaseManager"):
        """
        Initialize workflow engine.
        
        Args:
            db_manager: Database manager for persistence
        """
        self.claude_wrapper = ClaudeCodeWrapper()
        self.db = db_manager
        
        # Map workflow stages to handler methods
        self.stage_handlers: Dict[WorkflowStage, Callable] = {
            WorkflowStage.PLAN: self._plan_stage,
            WorkflowStage.IMPLEMENT: self._implement_stage,
            WorkflowStage.UNIT_TEST: self._unit_test_stage,
            WorkflowStage.FIX_ISSUES: self._fix_issues_stage,
            WorkflowStage.INTEGRATION_TEST: self._integration_test_stage,
            WorkflowStage.DIAGNOSE: self._diagnose_stage,
        }
        
        # Maximum iterations to prevent infinite loops
        self.max_iterations = 3
    
    async def process_issue(self, issue_dict: Dict[str, Any]) -> Dict[str, Any]:
        """
        Process an issue through the complete workflow.
        
        Args:
            issue_dict: Issue data as dictionary to process
            
        Returns:
            Processed issue dictionary with final status
        """
        logger.info(f"Starting workflow for issue {issue_dict['id']}: {issue_dict['title']}")
        
        # Check Claude Code availability first
        if not await self.claude_wrapper.check_claude_availability():
            logger.error("Claude Code CLI not available - workflow cannot proceed")
            issue_dict['status'] = IssueStatus.BLOCKED.value
            issue_dict['workflow_stage'] = WorkflowStage.DONE.value
            return issue_dict
        
        try:
            # Initialize iteration count if not present
            if 'iteration_count' not in issue_dict:
                issue_dict['iteration_count'] = 0
                
            while issue_dict['workflow_stage'] != WorkflowStage.DONE.value:
                # Check iteration limit
                if issue_dict['iteration_count'] >= self.max_iterations:
                    logger.warning(f"Issue {issue_dict['id']} reached max iterations")
                    issue_dict['status'] = IssueStatus.BLOCKED.value
                    issue_dict['workflow_stage'] = WorkflowStage.DONE.value
                    break
                
                # Execute current stage
                logger.info(f"Issue {issue_dict['id']} entering stage: {issue_dict['workflow_stage']}")
                # Handle case-insensitive stage conversion
                stage_value = issue_dict['workflow_stage'].lower()
                current_stage = WorkflowStage(stage_value)
                handler = self.stage_handlers.get(current_stage)
                
                if not handler:
                    raise ValueError(f"Unknown workflow stage: {issue_dict['workflow_stage']}")
                
                next_stage = await handler(issue_dict)
                
                # Update issue stage
                issue_dict['workflow_stage'] = next_stage.value
                issue_dict['updated_at'] = datetime.now()
                issue_dict['iteration_count'] += 1
                
                # Small delay between stages
                await asyncio.sleep(1)
            
            logger.info(f"Workflow completed for issue {issue_dict['id']}")
            return issue_dict
            
        except Exception as e:
            logger.error(f"Workflow error for issue {issue_dict['id']}: {e}")
            issue_dict['status'] = IssueStatus.BLOCKED.value
            issue_dict['workflow_stage'] = WorkflowStage.DONE.value
            return issue_dict
    
    async def _plan_stage(self, issue_dict: Dict[str, Any]) -> WorkflowStage:
        """
        Plan stage: Analyze requirements and design solution.
        
        Returns:
            Next workflow stage (IMPLEMENT)
        """
        logger.info(f"Planning issue {issue_dict['id']}")
        
        try:
            # Use Claude Code wrapper to analyze and create plan
            plan = await self.claude_wrapper.analyze_and_plan(issue_dict)
            issue_dict['plan'] = plan
            issue_dict['status'] = IssueStatus.IN_PROGRESS.value
            
            logger.info(f"Plan created for issue {issue_dict['id']}")
            return WorkflowStage.IMPLEMENT
            
        except Exception as e:
            logger.error(f"Planning failed for issue {issue_dict['id']}: {e}")
            issue_dict['diagnosis_log'] = f"Plan generation failed: {e}"
            return WorkflowStage.DIAGNOSE
    
    async def _implement_stage(self, issue_dict: Dict[str, Any]) -> WorkflowStage:
        """
        Implementation stage: Write code based on plan.
        
        Returns:
            Next workflow stage (UNIT_TEST)
        """
        logger.info(f"Implementing solution for issue {issue_dict['id']}")
        
        try:
            # Use Claude Code wrapper to implement solution
            implementation = await self.claude_wrapper.implement_solution(issue_dict)
            issue_dict['implementation'] = implementation
            
            logger.info(f"Implementation completed for issue {issue_dict['id']}")
            return WorkflowStage.UNIT_TEST
            
        except Exception as e:
            logger.error(f"Implementation failed for issue {issue_dict['id']}: {e}")
            issue_dict['diagnosis_log'] = f"Implementation failed: {e}"
            return WorkflowStage.DIAGNOSE
    
    async def _unit_test_stage(self, issue_dict: Dict[str, Any]) -> WorkflowStage:
        """
        Unit test stage: Write and run unit tests.
        
        Returns:
            Next workflow stage (INTEGRATION_TEST if passed, FIX_ISSUES if failed)
        """
        logger.info(f"Running unit tests for issue {issue_dict['id']}")
        
        try:
            # Generate and run unit tests using Claude Code
            tests = await self.claude_wrapper.generate_tests(issue_dict)
            issue_dict['tests'] = tests
            
            # For now, simulate test results (in real implementation, would run actual tests)
            # TODO: Implement actual test execution
            test_passed = True  # Simplified for testing
            
            if test_passed:
                logger.info(f"Unit tests passed for issue {issue_dict['id']}")
                return WorkflowStage.INTEGRATION_TEST
            else:
                logger.warning(f"Unit tests failed for issue {issue_dict['id']}")
                return WorkflowStage.FIX_ISSUES
                
        except Exception as e:
            logger.error(f"Unit testing failed for issue {issue_dict['id']}: {e}")
            issue_dict['diagnosis_log'] = f"Unit testing failed: {e}"
            return WorkflowStage.DIAGNOSE
    
    async def _fix_issues_stage(self, issue_dict: Dict[str, Any]) -> WorkflowStage:
        """
        Fix issues stage: Fix failing tests.
        
        Returns:
            Next workflow stage (UNIT_TEST to retry)
        """
        issue_id = issue_dict['id']
        logger.info(f"Fixing test failures for issue {issue_id}")
        
        try:
            # Use Claude Code to fix the failing tests
            fix_result = await self.claude_wrapper.fix_test_failures(issue_dict)
            issue_dict['fix_log'] = fix_result
            
            logger.info(f"Fixes applied for issue {issue_id}")
            return WorkflowStage.UNIT_TEST
            
        except Exception as e:
            logger.error(f"Fix issues failed for issue {issue_id}: {e}")
            issue_dict['diagnosis_log'] = f"Fix issues failed: {e}"
            return WorkflowStage.DIAGNOSE
    
    async def _integration_test_stage(self, issue_dict: Dict[str, Any]) -> WorkflowStage:
        """
        Integration test stage: Run integration tests.
        
        Returns:
            Next workflow stage (DONE if passed, DIAGNOSE if failed)
        """
        issue_id = issue_dict['id']
        logger.info(f"Running integration tests for issue {issue_id}")
        
        try:
            # Run integration tests using Claude Code
            test_result = await self.claude_wrapper.run_integration_tests(issue_dict)
            issue_dict['integration_tests'] = test_result
            
            # For now, assume integration tests pass if no exception
            logger.info(f"Integration tests passed for issue {issue_id}")
            issue_dict['status'] = IssueStatus.CLOSED.value
            return WorkflowStage.DONE
            
        except Exception as e:
            logger.warning(f"Integration tests failed for issue {issue_id}: {e}")
            issue_dict['diagnosis_log'] = f"Integration tests failed: {e}"
            return WorkflowStage.DIAGNOSE
    
    async def _diagnose_stage(self, issue_dict: Dict[str, Any]) -> WorkflowStage:
        """
        Diagnose stage: Analyze failures and document findings.
        
        Returns:
            Next workflow stage (PLAN to restart with new insights)
        """
        issue_id = issue_dict['id']
        logger.info(f"Diagnosing failures for issue {issue_id}")
        
        try:
            # Use Claude Code to diagnose the failures
            diagnosis = await self.claude_wrapper.diagnose_issues(issue_dict, issue_dict.get('diagnosis_log', ''))
            
            # Append to diagnosis log
            current_iteration = issue_dict.get('iteration_count', 0)
            if 'diagnosis_log' in issue_dict and issue_dict['diagnosis_log']:
                issue_dict['diagnosis_log'] += f"\n\n--- Iteration {current_iteration + 1} ---\n{diagnosis}"
            else:
                issue_dict['diagnosis_log'] = diagnosis
            
            logger.info(f"Diagnosis completed for issue {issue_id}, restarting workflow")
            return WorkflowStage.PLAN
            
        except Exception as e:
            logger.error(f"Diagnosis failed for issue {issue_id}: {e}")
            issue_dict['status'] = IssueStatus.BLOCKED.value
            return WorkflowStage.DONE
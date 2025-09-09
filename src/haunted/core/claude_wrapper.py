"""Claude Code CLI wrapper for processing issues using JSON output format."""

import json
import subprocess
from typing import Dict, Any

from ..utils.logger import get_logger

logger = get_logger(__name__)


class ClaudeCodeWrapper:
    """Wrapper for Claude Code CLI - uses --output-format json for structured responses."""

    def __init__(self):
        """Initialize Claude Code wrapper."""
        self.claude_cmd = "claude"

    async def check_claude_availability(self) -> bool:
        """
        Check if Claude Code CLI is available and user is authenticated.

        Returns:
            True if Claude Code CLI is available and user is authenticated
        """
        try:
            # Test Claude CLI availability with a simple command
            result = subprocess.run(
                [self.claude_cmd, "--version"],
                capture_output=True,
                text=True,
                timeout=10,
            )

            if result.returncode == 0:
                logger.info("Claude Code CLI is available")
                return True
            else:
                logger.error(
                    f"Claude CLI check failed with return code: {result.returncode}"
                )
                return False

        except Exception as e:
            logger.error(f"Claude CLI check failed: {e}")
            return False

    async def analyze_and_plan(self, issue_dict: Dict[str, Any]) -> Dict[str, Any]:
        """
        Analyze issue and create implementation plan using Claude Code CLI.

        Args:
            issue_dict: Issue data as dictionary

        Returns:
            Implementation plan as JSON dictionary
        """
        prompt = self._build_plan_prompt(issue_dict)

        try:
            response = await self._execute_claude_query(
                prompt,
                "You are an expert software architect analyzing issues and creating implementation plans.",
            )
            logger.info(f"Generated plan for issue {issue_dict.get('id', 'unknown')}")
            return response

        except Exception as e:
            logger.error(
                f"Plan generation failed for issue {issue_dict.get('id', 'unknown')}: {e}"
            )
            return {"error": f"Plan generation failed: {e}"}

    async def implement_solution(self, issue_dict: Dict[str, Any]) -> Dict[str, Any]:
        """
        Generate implementation using Claude Code CLI.

        Args:
            issue_dict: Issue data with plan

        Returns:
            Implementation details as JSON dictionary
        """
        prompt = self._build_implement_prompt(issue_dict)

        try:
            response = await self._execute_claude_query(
                prompt,
                "You are an expert software developer implementing solutions based on plans.",
            )
            logger.info(
                f"Generated implementation for issue {issue_dict.get('id', 'unknown')}"
            )
            return response

        except Exception as e:
            logger.error(
                f"Implementation generation failed for issue {issue_dict.get('id', 'unknown')}: {e}"
            )
            return {"error": f"Implementation generation failed: {e}"}

    async def generate_tests(self, issue_dict: Dict[str, Any]) -> Dict[str, Any]:
        """
        Generate unit tests using Claude Code CLI.

        Args:
            issue_dict: Issue data with implementation

        Returns:
            Test code as JSON dictionary
        """
        prompt = self._build_test_prompt(issue_dict)

        try:
            response = await self._execute_claude_query(
                prompt, "You are an expert in writing comprehensive unit tests."
            )
            logger.info(f"Generated tests for issue {issue_dict.get('id', 'unknown')}")
            return response

        except Exception as e:
            logger.error(
                f"Test generation failed for issue {issue_dict.get('id', 'unknown')}: {e}"
            )
            return {"error": f"Test generation failed: {e}"}

    async def diagnose_issues(
        self, issue_dict: Dict[str, Any], error_log: str
    ) -> Dict[str, Any]:
        """
        Diagnose issues using Claude Code CLI.

        Args:
            issue_dict: Issue data
            error_log: Error logs to analyze

        Returns:
            Diagnosis and fix suggestions as JSON dictionary
        """
        prompt = self._build_diagnose_prompt(issue_dict, error_log)

        try:
            response = await self._execute_claude_query(
                prompt, "You are an expert in debugging and problem diagnosis."
            )
            logger.info(
                f"Generated diagnosis for issue {issue_dict.get('id', 'unknown')}"
            )
            return response

        except Exception as e:
            logger.error(
                f"Diagnosis failed for issue {issue_dict.get('id', 'unknown')}: {e}"
            )
            return {"error": f"Diagnosis failed: {e}"}

    async def _execute_claude_query(
        self, prompt: str, system_prompt: str = ""
    ) -> Dict[str, Any]:
        """
        Execute a query using Claude Code CLI with JSON output format.

        Args:
            prompt: The prompt to send to Claude
            system_prompt: System prompt for context

        Returns:
            Claude's response as parsed JSON dictionary
        """
        try:
            logger.info("Executing Claude Code CLI query:")
            logger.info(f"System prompt: {system_prompt}")
            logger.info(f"User prompt: {prompt}")

            # Print prompt to console
            print("\n" + "=" * 60)
            print("📝 PROMPT TO CLAUDE CODE CLI")
            print("=" * 60)
            if system_prompt:
                print(f"🎯 SYSTEM: {system_prompt}")
                print("-" * 60)
            print(f"💬 USER: {prompt}")
            print("=" * 60)

            # Build Claude CLI command with JSON output format
            cmd = [
                self.claude_cmd,
                "--print",  # Non-interactive mode
                "--output-format",
                "json",  # Request JSON output
                prompt,
            ]

            # Add system prompt if provided
            if system_prompt:
                cmd.extend(["--append-system-prompt", system_prompt])

            # Execute Claude CLI command
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=300,  # 5 minute timeout
                encoding="utf-8",
            )

            if result.returncode != 0:
                logger.error(f"Claude CLI failed with return code {result.returncode}")
                logger.error(f"stderr: {result.stderr}")
                raise Exception(f"Claude CLI failed: {result.stderr}")

            # Parse JSON response
            try:
                response_json = json.loads(result.stdout)

                # Print Claude Code response to console
                print("\n" + "=" * 60)
                print("🤖 CLAUDE CODE CLI JSON RESPONSE")
                print("=" * 60)
                print(json.dumps(response_json, indent=2))
                print("=" * 60 + "\n")

                logger.info(
                    f"Claude CLI responded with JSON: {len(result.stdout)} characters"
                )
                return response_json

            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse Claude CLI JSON response: {e}")
                logger.error(f"Raw output: {result.stdout}")
                raise Exception(f"Invalid JSON response from Claude CLI: {e}")

        except Exception as e:
            logger.error(f"Error executing Claude CLI query: {e}")
            raise Exception(f"Error executing Claude CLI query: {e}")

    def _build_plan_prompt(self, issue_dict: Dict[str, Any]) -> str:
        """Build planning prompt for Claude Code CLI."""
        return f"""# Issue Analysis and Implementation Plan

## Issue Details
**Title**: {issue_dict.get("title", "No title")}
**Description**: {issue_dict.get("description", "No description")}
**Priority**: {issue_dict.get("priority", "Unknown")}

## Task
Please analyze this issue and create a detailed implementation plan. Include:

1. **Requirements Analysis**: List the key requirements and functional needs
2. **Solution Design**: Describe the architecture/approach, edge cases to consider, and any constraints
3. **Implementation Strategy**: Specify which files need to be created or modified, the implementation steps, and any dependencies
4. **Risk Assessment**: Identify potential risks and mitigation strategies

Provide a comprehensive analysis that will guide the implementation of this issue."""

    def _build_implement_prompt(self, issue_dict: Dict[str, Any]) -> str:
        """Build implementation prompt for Claude Code CLI."""
        plan = issue_dict.get("plan", "No plan available")

        return f"""# Implementation Task

## Issue Details
**Title**: {issue_dict.get("title", "No title")}
**Description**: {issue_dict.get("description", "No description")}

## Implementation Plan
{plan}

## Task
Based on the above plan, please provide detailed implementation guidance. Include:

1. **Files**: List all files that need to be created or modified, including their complete content and purpose
2. **Code Structure**: Describe the main components and how files are organized
3. **Implementation Notes**: Provide implementation details and best practices
4. **Integration Points**: Explain how this integrates with existing code and any configuration changes needed
5. **Next Steps**: Outline the steps needed to complete the implementation

Provide complete, working code for all files mentioned in the implementation."""

    def _build_test_prompt(self, issue_dict: Dict[str, Any]) -> str:
        """Build testing prompt for Claude Code CLI."""
        return f"""# Unit Test Generation

## Issue Details
**Title**: {issue_dict.get("title", "No title")}
**Description**: {issue_dict.get("description", "No description")}

## Task
Please generate comprehensive unit tests for the implementation of this issue. Include:

1. **Test Files**: Create complete test files with runnable test code, specifying the testing framework and what each file covers
2. **Test Coverage**: Cover happy path scenarios, edge cases, and error conditions
3. **Setup Requirements**: List any requirements needed to run the tests
4. **Run Instructions**: Provide clear instructions on how to run the tests and expected commands

Ensure all test code is complete and runnable."""

    def _build_diagnose_prompt(self, issue_dict: Dict[str, Any], error_log: str) -> str:
        """Build diagnosis prompt for Claude Code CLI."""
        return f"""# Issue Diagnosis

## Issue Details
**Title**: {issue_dict.get("title", "No title")}
**Description**: {issue_dict.get("description", "No description")}

## Error Log
```
{error_log}
```

## Task
Please analyze the error log and provide comprehensive diagnosis. Include:

1. **Root Cause Analysis**: Identify the primary cause, explain why the error occurred, and classify the error type
2. **Impact Assessment**: Describe the scope of the problem, identify affected components, and assess severity level
3. **Fix Recommendations**: Provide immediate steps to resolve the issue, specify needed code changes, and suggest preventive measures
4. **Testing Strategy**: Recommend verification tests and regression prevention measures

Provide actionable recommendations with specific steps to resolve the issue."""

    async def fix_test_failures(self, issue_dict: Dict[str, Any]) -> Dict[str, Any]:
        """
        Fix test failures using Claude Code CLI.

        Args:
            issue_dict: Issue data with test failure information

        Returns:
            Fix result as JSON dictionary
        """
        prompt = self._build_fix_prompt(issue_dict)

        try:
            response = await self._execute_claude_query(
                prompt, "You are an expert in debugging and fixing failing tests."
            )
            logger.info(f"Generated fix for issue {issue_dict.get('id', 'unknown')}")
            return response

        except Exception as e:
            logger.error(
                f"Fix generation failed for issue {issue_dict.get('id', 'unknown')}: {e}"
            )
            return {"error": f"Fix generation failed: {e}"}

    async def run_integration_tests(self, issue_dict: Dict[str, Any]) -> Dict[str, Any]:
        """
        Run integration tests using Claude Code CLI.

        Args:
            issue_dict: Issue data

        Returns:
            Integration test results as JSON dictionary
        """
        prompt = self._build_integration_test_prompt(issue_dict)

        try:
            response = await self._execute_claude_query(
                prompt, "You are an expert in integration testing."
            )
            logger.info(
                f"Ran integration tests for issue {issue_dict.get('id', 'unknown')}"
            )
            return response

        except Exception as e:
            logger.error(
                f"Integration testing failed for issue {issue_dict.get('id', 'unknown')}: {e}"
            )
            return {"error": f"Integration testing failed: {e}"}

    def _build_fix_prompt(self, issue_dict: Dict[str, Any]) -> str:
        """Build fix prompt for Claude Code CLI."""
        return f"""# Test Failure Fix
        
## Issue Details
**Title**: {issue_dict.get("title", "No title")}
**Description**: {issue_dict.get("description", "No description")}

## Implementation
{issue_dict.get("implementation", "No implementation available")}

## Test Results
{issue_dict.get("tests", "No test results available")}

## Task
The unit tests are failing. Please analyze the failures and provide fixes:

1. **Failure Analysis**: Identify specific test failures and understand why they're failing
2. **Root Cause**: Determine what in the implementation is causing failures and identify logic errors or missing functionality
3. **Fix Implementation**: Provide corrected code that addresses all test failures while maintaining existing functionality
4. **Verification**: Explain how the fixes resolve the issues and suggest additional tests if needed

Provide specific code fixes that will make the tests pass."""

    def _build_integration_test_prompt(self, issue_dict: Dict[str, Any]) -> str:
        """Build integration test prompt for Claude Code CLI."""
        return f"""# Integration Test Execution
        
## Issue Details
**Title**: {issue_dict.get("title", "No title")}
**Description**: {issue_dict.get("description", "No description")}

## Implementation
{issue_dict.get("implementation", "No implementation available")}

## Unit Tests
{issue_dict.get("tests", "No unit tests available")}

## Task
Please run integration tests for this implementation:

1. **System Integration**: Test integration with existing components and verify system-wide functionality
2. **End-to-End Testing**: Test complete workflows and verify user scenarios work correctly
3. **Performance Testing**: Check performance characteristics and identify potential bottlenecks
4. **Compatibility Testing**: Test with different environments and verify backward compatibility

Provide comprehensive integration test results and identify any issues."""

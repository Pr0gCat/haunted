"""Claude Code CLI wrapper for processing issues using JSON output format."""

import json
import subprocess
from typing import Dict, Any, Optional, List
from datetime import datetime, timedelta
import re

from haunted.utils.logger import get_logger

logger = get_logger(__name__)


class ClaudeCodeWrapper:
    """Wrapper for Claude Code CLI - uses --output-format json for structured responses."""

    def __init__(self, project_root: str = "."):
        """Initialize Claude Code wrapper."""
        self.claude_cmd = "claude"
        self.project_root = project_root

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
                "You are an expert software architect analyzing issues and creating implementation plans. Respond in English.",
                disallowed_tools=["Write", "Edit", "MultiEdit", "NotebookEdit"]
            )
            logger.info(f"Generated plan for issue {issue_dict.get('id', 'unknown')}")
            
            # Check if there's an error in the response
            if isinstance(response, dict) and "error" in response:
                logger.error(f"Claude returned an error: {response['error']}")
                return response
            
            # Extract the actual content from the response
            if isinstance(response, dict) and "content" in response:
                return {"plan": response["content"], "metadata": response.get("metadata")}
            elif isinstance(response, dict) and "result" in response:
                return {"plan": response["result"], "metadata": response.get("metadata")}
            else:
                # Assume the response itself is the plan
                return {"plan": response}

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
                "You are an expert software developer implementing solutions. Create actual files using your file creation tools. Respond in English.",
            )
            logger.info(
                f"Generated implementation for issue {issue_dict.get('id', 'unknown')}"
            )
            
            # Check if there's an error in the response
            if isinstance(response, dict) and "error" in response:
                logger.error(f"Claude returned an error: {response['error']}")
                return response
            
            # Extract the actual content from the response
            if isinstance(response, dict) and "content" in response:
                return {"implementation": response["content"], "metadata": response.get("metadata")}
            elif isinstance(response, dict) and "result" in response:
                return {"implementation": response["result"], "metadata": response.get("metadata")}
            else:
                # Assume the response itself is the implementation
                return {"implementation": response}

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
                prompt, 
                "You are an expert in debugging and problem diagnosis.",
                disallowed_tools=["Write", "Edit", "MultiEdit", "NotebookEdit"]
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

    async def resolve_merge_conflicts(self, conflict_summary: str) -> Dict[str, Any]:
        """
        Resolve git merge conflicts by editing files via Claude Code CLI tools.

        Args:
            conflict_summary: Text description of conflicted files and context

        Returns:
            Resolution result as JSON dictionary
        """
        prompt = self._build_merge_conflict_prompt(conflict_summary)

        try:
            response = await self._execute_claude_query(
                prompt,
                "You are an expert software engineer resolving git merge conflicts. Use file editing tools to fix conflicts and preserve intent from both branches. Respond in English.",
            )
            logger.info("Claude attempted to resolve merge conflicts")
            return response
        except Exception as e:
            logger.error(f"Merge conflict resolution failed: {e}")
            return {"error": f"Merge conflict resolution failed: {e}"}

    async def _execute_claude_query(
        self, prompt: str, system_prompt: str = "", disallowed_tools: List[str] = None
    ) -> Dict[str, Any]:
        """
        Execute a query using Claude Code CLI with JSON output format.

        Args:
            prompt: The prompt to send to Claude
            system_prompt: System prompt for context
            disallowed_tools: List of tool names to disallow (e.g., ["Write", "Edit", "MultiEdit"])

        Returns:
            Claude's response as parsed JSON dictionary
        """
        try:
            logger.info("Executing Claude Code CLI query:")
            logger.info(f"System prompt: {system_prompt}")
            logger.info(f"User prompt: {prompt}")
            if disallowed_tools:
                logger.info(f"Disallowed tools: {', '.join(disallowed_tools)}")

            # Build Claude CLI command with JSON output format
            cmd = [
                self.claude_cmd,
                "--print",  # Non-interactive mode
                "--output-format",
                "json",  # Request JSON output
                "--permission-mode",
                "bypassPermissions",  # Allow permissions but restrict tools
            ]
            
            # Add disallowed tools if specified
            if disallowed_tools:
                cmd.extend(["--disallowed-tools", " ".join(disallowed_tools)])

            # Add system prompt if provided
            if system_prompt:
                cmd.extend(["--append-system-prompt", system_prompt])
            
            # Add the prompt as the last argument (without extra quotes)
            cmd.append(prompt)

            logger.debug(f"Executing Claude CLI command: {' '.join(cmd[:5])}... [prompt truncated]")
            
            # Execute Claude CLI command in the project directory
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=300,  # 5 minute timeout
                encoding="utf-8",
                cwd=self.project_root,  # Use the configured project root
                shell=False,  # Don't use shell to avoid quote issues
            )
            logger.debug(f"Claude CLI result: {result.stdout}")

            # Detect rate limit or quota errors before parsing JSON
            rate_limit_reset = self._detect_rate_limit(result.stdout, result.stderr)
            if rate_limit_reset is not None:
                raise ClaudeRateLimitError("Claude CLI rate limit reached", rate_limit_reset)

            # Parse JSON response (be tolerant to wrappers like code fences or logs)
            try:
                raw_output = result.stdout or ""
                if not raw_output.strip():
                    logger.error("Claude CLI produced empty stdout")
                    logger.error(f"stderr: {result.stderr}")
                    raise Exception("Empty response from Claude CLI")

                sanitized = self._sanitize_json_output(raw_output)
                response_json = json.loads(sanitized)

                logger.info(
                    f"Claude CLI responded with JSON: {len(result.stdout)} characters"
                )
                
                # Parse JSON output and extract assistant content
                json_result = self._parse_json_output(response_json)
                return json_result

            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse Claude CLI JSON response: {e}")
                logger.error(f"Raw output: {result.stdout}")
                # If the raw output indicates rate limit, raise a structured error
                rate_limit_reset = self._detect_rate_limit(result.stdout, result.stderr)
                if rate_limit_reset is not None:
                    raise ClaudeRateLimitError("Claude CLI rate limit reached", rate_limit_reset)
                raise Exception(f"Invalid JSON response from Claude CLI: {e}")

        except Exception as e:
            logger.error(f"Error executing Claude CLI query: {e}")
            raise Exception(f"Error executing Claude CLI query: {e}")

    def _detect_rate_limit(self, stdout: Optional[str], stderr: Optional[str]) -> Optional[datetime]:
        """Detect rate limit or usage limit reached messages and return reset datetime if known.

        Recognizes phrases such as:
        - "limit reached"
        - "rate limit"
        - "5-hour limit reached ∙ resets 6pm"
        Attempts to parse a reset time if present; otherwise, backs off for 1 hour by default.
        """
        text = f"{stdout or ''}\n{stderr or ''}".lower()
        if not text:
            return None

        if ("limit reached" in text) or ("rate limit" in text) or ("quota" in text):
            # Try to parse explicit reset time like "resets 6pm" or "resets 18:00"
            reset_at: Optional[datetime] = None

            # Pattern: resets 6pm / 6 pm / 6:30pm / 18:00
            m = re.search(r"resets\s+([0-9]{1,2})(?::([0-9]{2}))?\s*(am|pm)?", text)
            now = datetime.now()
            if m:
                hour = int(m.group(1))
                minute = int(m.group(2) or 0)
                ampm = m.group(3)
                if ampm:
                    # Convert 12-hour to 24-hour
                    if ampm == "pm" and hour != 12:
                        hour += 12
                    if ampm == "am" and hour == 12:
                        hour = 0
                # Build today reset time; if already passed, use tomorrow
                candidate = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
                if candidate <= now:
                    candidate = candidate + timedelta(days=1)
                reset_at = candidate
            else:
                # Fallback: if we see "5-hour limit reached", wait 5 hours
                m2 = re.search(r"([0-9]+)\s*-?hour limit reached", text)
                if m2:
                    hours = int(m2.group(1))
                    reset_at = now + timedelta(hours=hours)
                else:
                    # Default conservative backoff: 1 hour
                    reset_at = now + timedelta(hours=1)

            return reset_at

        return None

    def _sanitize_json_output(self, output: str) -> str:
        """Sanitize Claude CLI output to extract a JSON object string.

        - Strips code fences like ```json ... ``` or ``` ... ```
        - Trims whitespace and surrounding noise
        - Attempts to extract the first balanced JSON object if extra text present
        """
        text = output.strip()

        # Remove leading/trailing code fences
        fence_pattern = r"^```(?:json)?\s*([\s\S]*?)\s*```$"
        m = re.match(fence_pattern, text, re.IGNORECASE)
        if m:
            text = m.group(1).strip()

        # If the entire text isn't pure JSON, try to extract the first JSON object
        if not text.startswith("{") or not text.endswith("}"):
            extracted = self._extract_first_json_object(text)
            if extracted:
                return extracted
        return text

    def _extract_first_json_object(self, text: str) -> str:
        """Extract the first top-level JSON object substring from arbitrary text.

        Uses brace counting to find a balanced {...} region.
        Returns empty string if none found.
        """
        start = text.find("{")
        if start == -1:
            return ""
        depth = 0
        in_str = False
        escape = False
        for i in range(start, len(text)):
            ch = text[i]
            if in_str:
                if escape:
                    escape = False
                elif ch == "\\":
                    escape = True
                elif ch == '"':
                    in_str = False
            else:
                if ch == '"':
                    in_str = True
                elif ch == '{':
                    depth += 1
                elif ch == '}':
                    depth -= 1
                    if depth == 0:
                        return text[start : i + 1]
        return ""

    def _parse_json_output(self, response_json: Dict[str, Any]) -> Dict[str, Any]:
        """Parse JSON output format from Claude Code CLI."""
        
        # Check if this is an error response
        if response_json.get("type") == "result" and response_json.get("subtype") == "error_during_execution":
            error_msg = response_json.get("error", "Unknown error occurred during execution")
            logger.error(f"Claude CLI execution error: {error_msg}")
            return {"error": error_msg, "metadata": response_json}
        
        # Check for successful completion
        if response_json.get("type") == "result" and response_json.get("subtype") == "success" and not response_json.get("is_error"):
            usage = response_json.get("usage", {})
            input_tokens = (usage.get("input_tokens", 0) + usage.get("cache_read_input_tokens", 0))
            output_tokens = usage.get("output_tokens", 0)
            total_tokens = input_tokens + output_tokens
            
            # Extract the actual content from the result field
            content = response_json.get("result", "")
            
            return {
                "content": content,
                "metadata": {
                    "success": True,
                    "tokens_used": total_tokens,
                    "token_details": {
                        "input_tokens": input_tokens,
                        "output_tokens": output_tokens,
                        "cache_creation_tokens": usage.get("cache_creation_input_tokens"),
                        "cache_read_tokens": usage.get("cache_read_input_tokens"),
                    },
                    "session_id": response_json.get("session_id"),
                    "cost_usd": response_json.get("total_cost_usd"),
                    "duration_ms": response_json.get("duration_ms"),
                    "raw_result": response_json
                }
            }
        else:
            # Handle other response types or errors
            if "result" in response_json:
                actual_result = response_json["result"]
                if isinstance(actual_result, str):
                    return {"content": actual_result, "metadata": response_json}
                elif isinstance(actual_result, dict):
                    actual_result["metadata"] = response_json
                    return actual_result
                else:
                    return {"result": actual_result, "metadata": response_json}
            
            # Fallback - return the response as-is
            return response_json

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
        
        # Extract plan text if it's in a dict
        if isinstance(plan, dict):
            plan = plan.get("plan", str(plan))

        return f"""# Implementation Task

## Issue Details
**Title**: {issue_dict.get("title", "No title")}
**Description**: {issue_dict.get("description", "No description")}

## Implementation Plan
{plan}

## Task
Based on the above plan, please CREATE the actual implementation files. 

**IMPORTANT**: You MUST use your file creation tools (Write, Edit, MultiEdit) to create the actual files.

1. Create all necessary files (HTML, CSS, JavaScript, etc.) for a complete Snake game
2. Implement the specific feature described in the issue
3. Ensure the code is complete, working, and follows best practices
4. The game should be playable in a web browser

Do not just describe what to do - actually CREATE the files with complete, working code.

Start by checking what files already exist, then create or modify files as needed."""

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

    def _build_merge_conflict_prompt(self, conflict_summary: str) -> str:
        """Build merge conflict resolution prompt for Claude Code CLI."""
        return f"""# Resolve Git Merge Conflicts

The repository is currently in a MERGE-CONFLICT state after attempting to merge a feature branch.

## Conflict Summary
{conflict_summary}

## Task
Using your file editing tools, resolve ALL merge conflicts in the repository:

1. Open each conflicted file and remove conflict markers (<<<<<<<, =======, >>>>>>>).
2. Integrate both sides' intent into a coherent final version with correct imports, logic, and tests.
3. Ensure the project builds and tests still make sense (you can add/modify tests if needed).
4. Do not perform git operations; only edit files. I will stage and commit.

When finished, briefly summarize the major decisions you made per file.
"""


class ClaudeRateLimitError(Exception):
    """Raised when Claude CLI indicates a rate/usage limit has been reached."""

    def __init__(self, message: str, reset_at: Optional[datetime] = None):
        super().__init__(message)
        self.reset_at = reset_at

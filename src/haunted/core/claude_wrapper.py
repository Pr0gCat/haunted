"""Claude Code CLI wrapper for processing issues using JSON streaming output format."""

import json
import subprocess
import asyncio
import time
from typing import Dict, Any

from haunted.utils.logger import get_logger

logger = get_logger(__name__)


class ClaudeCodeWrapper:
    """Wrapper for Claude Code CLI - uses streaming JSON with per-action timeouts."""

    def __init__(self, action_timeout: float = 120.0):
        """Initialize Claude Code wrapper.
        
        Args:
            action_timeout: Timeout in seconds for each action (default: 2 minutes)
        """
        self.claude_cmd = "claude"
        self.action_timeout = action_timeout

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
        Execute a query using Claude Code CLI with streaming JSON and per-action timeout.

        Args:
            prompt: The prompt to send to Claude
            system_prompt: System prompt for context

        Returns:
            Claude's response as parsed JSON dictionary
        """
        try:
            logger.info("Executing Claude Code CLI query with streaming:")
            logger.info(f"System prompt: {system_prompt}")
            logger.info(f"User prompt: {prompt}")

            # Print prompt to console
            print("\n" + "=" * 60)
            print("📝 PROMPT TO CLAUDE CODE CLI (STREAMING)")
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

            # Execute with streaming and per-action timeout
            response_json = await self._stream_claude_execution(cmd)
            
            # Print Claude Code response to console
            print("\n" + "=" * 60)
            print("🤖 CLAUDE CODE CLI STREAMING RESPONSE")
            print("=" * 60)
            print(json.dumps(response_json, indent=2))
            print("=" * 60 + "\n")

            logger.info(
                f"Claude CLI responded with streamed JSON: {len(str(response_json))} characters"
            )
            
            # Print all detected actions from the stream
            self._print_all_claude_actions(response_json)
            
            # Extract actual content from Claude Code CLI response
            if isinstance(response_json, dict) and 'result' in response_json:
                actual_content = response_json['result']
                logger.info("Extracted result content from Claude CLI response")
                return actual_content
            else:
                logger.warning("Claude CLI response format unexpected, returning full response")
                return response_json

        except Exception as e:
            logger.error(f"Error executing Claude CLI query: {e}")
            raise Exception(f"Error executing Claude CLI query: {e}")
    
    async def _stream_claude_execution(self, cmd: list) -> Dict[str, Any]:
        """
        Execute Claude CLI command with streaming JSON parsing and action-level timeout.
        
        Args:
            cmd: Command list to execute
            
        Returns:
            Parsed JSON response
        """
        process = None
        try:
            # Start the Claude CLI process
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            
            logger.info("Started Claude CLI process with streaming")
            print("🔄 Starting Claude Code CLI streaming...")
            
            # Stream and parse JSON with action timeout
            response_data = await self._parse_streaming_json(process)
            
            # Wait for process to complete
            returncode = await process.wait()
            
            if returncode != 0:
                stderr_bytes = await process.stderr.read() if process.stderr else b""
                stderr = stderr_bytes.decode('utf-8', errors='replace')
                logger.error(f"Claude CLI failed with return code {returncode}")
                logger.error(f"stderr: {stderr}")
                raise Exception(f"Claude CLI failed: {stderr}")
                
            logger.info("Claude CLI process completed successfully")
            return response_data
            
        except asyncio.TimeoutError:
            if process:
                process.terminate()
                try:
                    await asyncio.wait_for(process.wait(), timeout=5.0)
                except asyncio.TimeoutError:
                    process.kill()
            logger.error("Claude CLI execution timed out")
            raise Exception("Claude CLI execution timed out")
            
        except Exception as e:
            if process:
                process.terminate()
                try:
                    await asyncio.wait_for(process.wait(), timeout=5.0)
                except asyncio.TimeoutError:
                    process.kill()
            logger.error(f"Error in streaming Claude CLI execution: {e}")
            raise
    
    async def _parse_streaming_json(self, process) -> Dict[str, Any]:
        """
        Parse streaming JSON output from Claude CLI with action-level timeout.
        
        Args:
            process: The subprocess instance
            
        Returns:
            Parsed JSON response
        """
        buffer = ""
        last_activity = time.time()
        actions_seen = set()
        
        try:
            while True:
                # Check for action timeout
                current_time = time.time()
                if current_time - last_activity > self.action_timeout:
                    logger.warning(f"Action timeout exceeded ({self.action_timeout}s), terminating")
                    raise asyncio.TimeoutError(f"No activity for {self.action_timeout} seconds")
                
                # Read with a small timeout to allow periodic timeout checks
                try:
                    chunk_bytes = await asyncio.wait_for(
                        process.stdout.read(1024), 
                        timeout=1.0
                    )
                except asyncio.TimeoutError:
                    # No data available, continue checking
                    continue
                
                if not chunk_bytes:
                    # EOF reached
                    break
                    
                # Decode bytes to string
                chunk = chunk_bytes.decode('utf-8', errors='replace')
                buffer += chunk
                last_activity = current_time
                
                # Check for action indicators in the stream
                new_actions = self._detect_actions_in_buffer(buffer)
                if new_actions - actions_seen:
                    # New action detected, reset timeout
                    actions_seen.update(new_actions)
                    last_activity = current_time
                    logger.info(f"New actions detected: {new_actions - actions_seen}")
                    print(f"⚡ Action detected: {', '.join(new_actions - actions_seen)}")
                
                # Try to parse complete JSON objects
                self._log_streaming_progress(buffer)
                
            # Parse final JSON
            logger.info("Parsing final JSON from streaming buffer")
            return self._parse_final_json(buffer)
            
        except Exception as e:
            logger.error(f"Error parsing streaming JSON: {e}")
            raise
    
    def _detect_actions_in_buffer(self, buffer: str) -> set:
        """
        Detect Claude Code actions in the streaming buffer.

        Args:
            buffer: Current buffer content
            
        Returns:
            Set of detected actions
        """
        actions = set()
        
        # Common Claude Code action indicators
        action_patterns = [
            "tool_use",
            "bash",
            "edit",
            "read",
            "write",
            "grep",
            "glob",
            "thinking",
            "response"
        ]
        
        for pattern in action_patterns:
            if pattern in buffer.lower():
                actions.add(pattern)
                
        return actions
    
    def _log_streaming_progress(self, buffer: str):
        """
        Log streaming progress.

        Args:
            buffer: Current buffer content
        """
        # Log periodically to show progress
        if len(buffer) % 5000 == 0 and len(buffer) > 0:
            logger.debug(f"Streaming progress: {len(buffer)} characters buffered")
    
    def _parse_final_json(self, buffer: str) -> Dict[str, Any]:
        """
        Parse the final JSON from the buffer.

        Args:
            buffer: Complete buffer content
            
        Returns:
            Parsed JSON response
        """
        try:
            # Try to parse as complete JSON first
            return json.loads(buffer)
            
        except json.JSONDecodeError:
            # If that fails, try to extract JSON from the buffer
            # Look for JSON objects in the buffer
            json_start = buffer.find('{')
            if json_start == -1:
                logger.error("No JSON found in buffer")
                logger.error(f"Buffer content: {buffer[:500]}...")
                raise Exception("No valid JSON found in Claude CLI output")
                
            # Try to find the matching closing brace
            brace_count = 0
            json_end = json_start
            
            for i in range(json_start, len(buffer)):
                if buffer[i] == '{':
                    brace_count += 1
                elif buffer[i] == '}':
                    brace_count -= 1
                    if brace_count == 0:
                        json_end = i + 1
                        break
                        
            if brace_count != 0:
                logger.error("Incomplete JSON in buffer")
                logger.error(f"Buffer content: {buffer[:500]}...")
                raise Exception("Incomplete JSON in Claude CLI output")
                
            json_str = buffer[json_start:json_end]
            return json.loads(json_str)
            
        except Exception as e:
            logger.error(f"Failed to parse final JSON: {e}")
            logger.error(f"Buffer content: {buffer[:500]}...")
            raise Exception(f"Invalid JSON response from Claude CLI: {e}")

    def _print_all_claude_actions(self, response_json: Dict[str, Any]):
        """
        Print all Claude Code actions detected in the streaming JSON response.
        
        Args:
            response_json: The complete JSON response from Claude Code CLI
        """
        print("\n" + "🔍 CLAUDE CODE ACTIONS DETECTED:")
        print("=" * 60)
        
        try:
            # Print basic response info
            if isinstance(response_json, dict):
                print(f"📊 Response Type: {response_json.get('type', 'unknown')}")
                print(f"📈 Subtype: {response_json.get('subtype', 'unknown')}")
                print(f"⏱️  Duration: {response_json.get('duration_ms', 0)}ms")
                print(f"🔄 Turns: {response_json.get('num_turns', 0)}")
                print(f"💰 Cost: ${response_json.get('total_cost_usd', 0)}")
                
                # Print usage statistics
                usage = response_json.get('usage', {})
                if usage:
                    print(f"📝 Input Tokens: {usage.get('input_tokens', 0)}")
                    print(f"📤 Output Tokens: {usage.get('output_tokens', 0)}")
                    print(f"💾 Cache Read: {usage.get('cache_read_input_tokens', 0)}")
                    print(f"🏗️  Cache Creation: {usage.get('cache_creation_input_tokens', 0)}")
                
                # Analyze the result content for tool usage and actions
                result_content = response_json.get('result', '')
                if result_content:
                    print(f"📋 Result Length: {len(result_content)} characters")
                    
                    # Detect various Claude Code actions in the result
                    actions_detected = self._analyze_result_for_actions(result_content)
                    if actions_detected:
                        print("🛠️  Detected Actions:")
                        for action in actions_detected:
                            print(f"   • {action}")
                    else:
                        print("ℹ️  No specific actions detected in result content")
                
                # Check for errors
                is_error = response_json.get('is_error', False)
                if is_error:
                    print("❌ Error detected in response")
                else:
                    print("✅ Response completed successfully")
                    
            else:
                print("⚠️  Unexpected response format - not a dictionary")
                
        except Exception as e:
            logger.error(f"Error analyzing Claude Code actions: {e}")
            print(f"❌ Error analyzing actions: {e}")
        
        print("=" * 60 + "\n")
    
    def _analyze_result_for_actions(self, result_content: str) -> list:
        """
        Analyze the result content to detect Claude Code actions and tool usage.
        
        Args:
            result_content: The result content to analyze
            
        Returns:
            List of detected actions
        """
        actions = []
        
        # Convert to lowercase for case-insensitive matching
        content_lower = result_content.lower()
        
        # Tool usage patterns
        tool_patterns = {
            'bash': ['```bash', 'bash命令', 'bash指令', 'shell命令'],
            'read': ['reading file', '讀取檔案', 'file content', '檔案內容'],
            'write': ['writing file', '寫入檔案', 'creating file', '建立檔案'],
            'edit': ['editing file', '編輯檔案', 'modifying', '修改'],
            'grep': ['searching', '搜尋', 'grep', 'finding'],
            'glob': ['pattern matching', '模式匹配', 'file pattern'],
            'task': ['launching agent', '啟動代理', 'task execution'],
            'web_fetch': ['fetching url', '抓取網址', 'web request'],
            'web_search': ['searching web', '網路搜尋', 'web search']
        }
        
        # Check for tool usage
        for tool, patterns in tool_patterns.items():
            for pattern in patterns:
                if pattern in content_lower:
                    actions.append(f"Tool: {tool.upper()}")
                    break
        
        # Check for code blocks
        code_block_patterns = ['```', '`', 'code', '程式碼', 'function', '函數']
        for pattern in code_block_patterns:
            if pattern in content_lower:
                actions.append("Code Generation")
                break
        
        # Check for file operations
        file_patterns = ['file:', 'src/', 'path:', '檔案:', '路徑:']
        for pattern in file_patterns:
            if pattern in content_lower:
                actions.append("File Operations")
                break
        
        # Check for analysis/planning
        analysis_patterns = ['analysis', '分析', 'plan', '計畫', 'strategy', '策略']
        for pattern in analysis_patterns:
            if pattern in content_lower:
                actions.append("Analysis/Planning")
                break
        
        # Check for implementation
        impl_patterns = ['implement', '實現', 'solution', '解決方案', 'fix', '修復']
        for pattern in impl_patterns:
            if pattern in content_lower:
                actions.append("Implementation")
                break
        
        # Check for testing
        test_patterns = ['test', '測試', 'unit test', '單元測試', 'integration test']
        for pattern in test_patterns:
            if pattern in content_lower:
                actions.append("Testing")
                break
        
        return list(set(actions))  # Remove duplicates

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
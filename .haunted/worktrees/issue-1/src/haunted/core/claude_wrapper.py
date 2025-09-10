"""Claude Code SDK wrapper for processing issues without direct API key."""

import asyncio
import json
from typing import Dict, Any, Optional

from claude_code_sdk import ClaudeSDKClient, ClaudeCodeOptions

from ..utils.logger import get_logger

logger = get_logger(__name__)


class ClaudeCodeWrapper:
    """Wrapper for Claude Code SDK - no API key required, uses local Claude Code authentication."""
    
    def __init__(self):
        """Initialize Claude Code wrapper."""
        self.client = None
        
    async def check_claude_availability(self) -> bool:
        """
        Check if Claude Code SDK is available and user is logged in.
        
        Returns:
            True if Claude Code SDK is available and user is authenticated
        """
        try:
            # 嘗試建立連線來測試可用性
            async with ClaudeSDKClient() as client:
                logger.info("Claude Code SDK is available and user is logged in")
                return True
                
        except Exception as e:
            logger.error(f"Claude SDK check failed: {e}")
            return False
    
    async def analyze_and_plan(self, issue_dict: Dict[str, Any]) -> str:
        """
        Analyze issue and create implementation plan using Claude Code SDK.
        
        Args:
            issue_dict: Issue data as dictionary
            
        Returns:
            Implementation plan as string
        """
        prompt = self._build_plan_prompt(issue_dict)
        
        try:
            response = await self._execute_claude_query(prompt, "You are an expert software architect analyzing issues and creating implementation plans.")
            logger.info(f"Generated plan for issue {issue_dict.get('id', 'unknown')}")
            return response
            
        except Exception as e:
            logger.error(f"Plan generation failed for issue {issue_dict.get('id', 'unknown')}: {e}")
            return f"Plan generation failed: {e}"
    
    async def implement_solution(self, issue_dict: Dict[str, Any]) -> str:
        """
        Generate implementation using Claude Code SDK.
        
        Args:
            issue_dict: Issue data with plan
            
        Returns:
            Implementation details as string
        """
        prompt = self._build_implement_prompt(issue_dict)
        
        try:
            response = await self._execute_claude_query(prompt, "You are an expert software developer implementing solutions based on plans.")
            logger.info(f"Generated implementation for issue {issue_dict.get('id', 'unknown')}")
            return response
            
        except Exception as e:
            logger.error(f"Implementation generation failed for issue {issue_dict.get('id', 'unknown')}: {e}")
            return f"Implementation generation failed: {e}"
    
    async def generate_tests(self, issue_dict: Dict[str, Any]) -> str:
        """
        Generate unit tests using Claude Code SDK.
        
        Args:
            issue_dict: Issue data with implementation
            
        Returns:
            Test code as string
        """
        prompt = self._build_test_prompt(issue_dict)
        
        try:
            response = await self._execute_claude_query(prompt, "You are an expert in writing comprehensive unit tests.")
            logger.info(f"Generated tests for issue {issue_dict.get('id', 'unknown')}")
            return response
            
        except Exception as e:
            logger.error(f"Test generation failed for issue {issue_dict.get('id', 'unknown')}: {e}")
            return f"Test generation failed: {e}"
    
    async def diagnose_issues(self, issue_dict: Dict[str, Any], error_log: str) -> str:
        """
        Diagnose issues using Claude Code SDK.
        
        Args:
            issue_dict: Issue data
            error_log: Error logs to analyze
            
        Returns:
            Diagnosis and fix suggestions
        """
        prompt = self._build_diagnose_prompt(issue_dict, error_log)
        
        try:
            response = await self._execute_claude_query(prompt, "You are an expert in debugging and problem diagnosis.")
            logger.info(f"Generated diagnosis for issue {issue_dict.get('id', 'unknown')}")
            return response
            
        except Exception as e:
            logger.error(f"Diagnosis failed for issue {issue_dict.get('id', 'unknown')}: {e}")
            return f"Diagnosis failed: {e}"
    
    async def _execute_claude_query(self, prompt: str, system_prompt: str = "") -> str:
        """
        Execute a query using Claude Code SDK.
        
        Args:
            prompt: The prompt to send to Claude
            system_prompt: System prompt for context
            
        Returns:
            Claude's response as string
        """
        try:
            logger.info(f"Executing Claude Code SDK query:")
            logger.info(f"System prompt: {system_prompt}")
            logger.info(f"User prompt: {prompt}")
            
            # Print prompt to console
            print("\n" + "="*60)
            print("📝 PROMPT TO CLAUDE CODE")
            print("="*60)
            if system_prompt:
                print(f"🎯 SYSTEM: {system_prompt}")
                print("-"*60)
            print(f"💬 USER: {prompt}")
            print("="*60)
            
            options = ClaudeCodeOptions(
                system_prompt=system_prompt,
                max_turns=1
            )
            
            response_text = ""
            
            async with ClaudeSDKClient(options=options) as client:
                # Send the query
                await client.query(prompt)
                
                # Wait for and collect the complete response
                complete = False
                async for message in client.receive_response():
                    if hasattr(message, 'content'):
                        for block in message.content:
                            if hasattr(block, 'text'):
                                response_text += block.text
                    
                    # Check if response is complete
                    if hasattr(message, 'type') and message.type == 'message':
                        if hasattr(message, 'stop_reason') and message.stop_reason:
                            complete = True
                            break
                
                # If we don't have a completion signal, the response should be complete
                if not complete:
                    logger.info("Response completed without explicit stop signal")
            
            if response_text.strip():
                logger.info(f"Claude SDK responded with {len(response_text)} characters")
                
                # Print Claude Code response to console
                print("\n" + "="*60)
                print("🤖 CLAUDE CODE RESPONSE")
                print("="*60)
                print(response_text.strip())
                print("="*60 + "\n")
                
                # Try to parse as JSON and validate
                try:
                    parsed_json = self._extract_and_parse_json(response_text.strip())
                    if parsed_json:
                        print("✅ JSON Response Successfully Parsed")
                        print("="*60)
                        print(json.dumps(parsed_json, indent=2))
                        print("="*60 + "\n")
                        return json.dumps(parsed_json)
                except Exception as json_error:
                    print(f"⚠️ JSON Parse Error: {json_error}")
                    print("Returning raw response...")
                
                return response_text.strip()
            else:
                return "Claude provided an empty response."
                
        except Exception as e:
            logger.error(f"Error executing Claude SDK query: {e}")
            return f"Error executing Claude SDK query: {e}"
    
    def _extract_and_parse_json(self, response_text: str) -> Optional[Dict[str, Any]]:
        """
        Extract and parse JSON from Claude's response.
        
        Args:
            response_text: Raw response text from Claude
            
        Returns:
            Parsed JSON object or None if parsing fails
        """
        # Try to find JSON in code blocks first
        import re
        
        # Look for JSON in code blocks
        json_pattern = r'```(?:json)?\s*(\{.*?\})\s*```'
        matches = re.findall(json_pattern, response_text, re.DOTALL)
        
        if matches:
            for match in matches:
                try:
                    return json.loads(match)
                except json.JSONDecodeError:
                    continue
        
        # Try to parse the entire response as JSON
        try:
            return json.loads(response_text)
        except json.JSONDecodeError:
            pass
        
        # Try to extract JSON-like content
        # Look for content between { and }
        json_start = response_text.find('{')
        json_end = response_text.rfind('}') + 1
        
        if json_start != -1 and json_end > json_start:
            try:
                potential_json = response_text[json_start:json_end]
                return json.loads(potential_json)
            except json.JSONDecodeError:
                pass
        
        return None
    
    def _build_plan_prompt(self, issue_dict: Dict[str, Any]) -> str:
        """Build planning prompt for Claude Code SDK."""
        return f"""# Issue Analysis and Implementation Plan

## Issue Details
**Title**: {issue_dict.get('title', 'No title')}
**Description**: {issue_dict.get('description', 'No description')}
**Priority**: {issue_dict.get('priority', 'Unknown')}

## Task
Please analyze this issue and create a detailed implementation plan. 

**IMPORTANT: Please respond with a valid JSON object in the following format:**

```json
{{
  "requirements_analysis": [
    "requirement 1",
    "requirement 2"
  ],
  "solution_design": {{
    "architecture": "description of the architecture/approach",
    "edge_cases": ["edge case 1", "edge case 2"],
    "constraints": ["constraint 1", "constraint 2"]
  }},
  "implementation_strategy": {{
    "files_to_create": ["file1.html", "file2.js"],
    "files_to_modify": ["existing_file.css"],
    "steps": [
      "Step 1: description",
      "Step 2: description"
    ],
    "dependencies": ["dependency 1", "dependency 2"]
  }},
  "risk_assessment": {{
    "risks": ["risk 1", "risk 2"],
    "mitigation_strategies": ["strategy 1", "strategy 2"]
  }}
}}
```

Please provide only the JSON response, no additional text before or after."""

    def _build_implement_prompt(self, issue_dict: Dict[str, Any]) -> str:
        """Build implementation prompt for Claude Code SDK."""
        plan = issue_dict.get('plan', 'No plan available')
        
        return f"""# Implementation Task

## Issue Details
**Title**: {issue_dict.get('title', 'No title')}
**Description**: {issue_dict.get('description', 'No description')}

## Implementation Plan
{plan}

## Task
Based on the above plan, please provide detailed implementation guidance.

**IMPORTANT: Please respond with a valid JSON object in the following format:**

```json
{{
  "files": [
    {{
      "path": "path/to/file.ext",
      "action": "create|modify",
      "content": "complete file content here",
      "description": "what this file does"
    }}
  ],
  "code_structure": {{
    "main_components": ["component 1", "component 2"],
    "file_organization": "description of how files are organized"
  }},
  "implementation_notes": [
    "note 1 about implementation",
    "note 2 about best practices"
  ],
  "integration_points": [
    "how this integrates with existing code",
    "configuration changes needed"
  ],
  "next_steps": [
    "step 1",
    "step 2"
  ]
}}
```

Please provide only the JSON response with complete, working code in the files array."""

    def _build_test_prompt(self, issue_dict: Dict[str, Any]) -> str:
        """Build testing prompt for Claude Code SDK."""
        return f"""# Unit Test Generation

## Issue Details
**Title**: {issue_dict.get('title', 'No title')}
**Description**: {issue_dict.get('description', 'No description')}

## Task
Please generate comprehensive unit tests for the implementation of this issue.

**IMPORTANT: Please respond with a valid JSON object in the following format:**

```json
{{
  "test_files": [
    {{
      "path": "path/to/test_file.js",
      "content": "complete test file content",
      "framework": "testing framework used",
      "description": "what this test file covers"
    }}
  ],
  "test_coverage": {{
    "happy_path_scenarios": ["scenario 1", "scenario 2"],
    "edge_cases": ["edge case 1", "edge case 2"],
    "error_conditions": ["error 1", "error 2"]
  }},
  "setup_requirements": [
    "requirement 1",
    "requirement 2"
  ],
  "run_instructions": [
    "how to run the tests",
    "expected test commands"
  ]
}}
```

Please provide only the JSON response with complete, runnable test code."""

    def _build_diagnose_prompt(self, issue_dict: Dict[str, Any], error_log: str) -> str:
        """Build diagnosis prompt for Claude Code SDK."""
        return f"""# Issue Diagnosis

## Issue Details
**Title**: {issue_dict.get('title', 'No title')}
**Description**: {issue_dict.get('description', 'No description')}

## Error Log
```
{error_log}
```

## Task
Please analyze the error log and provide diagnosis.

**IMPORTANT: Please respond with a valid JSON object in the following format:**

```json
{{
  "root_cause": {{
    "primary_cause": "description of primary cause",
    "explanation": "why the error occurred",
    "error_type": "type of error"
  }},
  "impact_assessment": {{
    "scope": "scope of the problem",
    "affected_components": ["component 1", "component 2"],
    "severity": "low|medium|high|critical"
  }},
  "fix_recommendations": {{
    "immediate_steps": ["step 1", "step 2"],
    "code_changes": [
      {{
        "file": "path/to/file",
        "change": "description of change needed"
      }}
    ],
    "preventive_measures": ["measure 1", "measure 2"]
  }},
  "testing_strategy": {{
    "verification_tests": ["test 1", "test 2"],
    "regression_prevention": ["prevention 1", "prevention 2"]
  }}
}}
```

Please provide only the JSON response with actionable recommendations."""
    
    async def fix_test_failures(self, issue_dict: Dict[str, Any]) -> str:
        """
        Fix test failures using Claude Code SDK.
        
        Args:
            issue_dict: Issue data with test failure information
            
        Returns:
            Fix result as string
        """
        prompt = self._build_fix_prompt(issue_dict)
        
        try:
            response = await self._execute_claude_query(prompt, "You are an expert in debugging and fixing failing tests.")
            logger.info(f"Generated fix for issue {issue_dict.get('id', 'unknown')}")
            return response
            
        except Exception as e:
            logger.error(f"Fix generation failed for issue {issue_dict.get('id', 'unknown')}: {e}")
            return f"Fix generation failed: {e}"
    
    async def run_integration_tests(self, issue_dict: Dict[str, Any]) -> str:
        """
        Run integration tests using Claude Code SDK.
        
        Args:
            issue_dict: Issue data
            
        Returns:
            Integration test results as string
        """
        prompt = self._build_integration_test_prompt(issue_dict)
        
        try:
            response = await self._execute_claude_query(prompt, "You are an expert in integration testing.")
            logger.info(f"Ran integration tests for issue {issue_dict.get('id', 'unknown')}")
            return response
            
        except Exception as e:
            logger.error(f"Integration testing failed for issue {issue_dict.get('id', 'unknown')}: {e}")
            return f"Integration testing failed: {e}"
    
    def _build_fix_prompt(self, issue_dict: Dict[str, Any]) -> str:
        """Build fix prompt for Claude Code SDK."""
        return f"""# Test Failure Fix
        
## Issue Details
**Title**: {issue_dict.get('title', 'No title')}
**Description**: {issue_dict.get('description', 'No description')}

## Implementation
{issue_dict.get('implementation', 'No implementation available')}

## Test Results
{issue_dict.get('tests', 'No test results available')}

## Task
The unit tests are failing. Please analyze the failures and provide fixes:

1. **Failure Analysis**
   - Identify specific test failures
   - Understand why tests are failing

2. **Root Cause**
   - Determine what in the implementation is causing failures
   - Identify logic errors or missing functionality

3. **Fix Implementation**
   - Provide corrected code
   - Ensure fixes address all test failures
   - Maintain existing functionality

4. **Verification**
   - Explain how the fixes resolve the issues
   - Suggest additional tests if needed

Please provide specific code fixes that will make the tests pass.
"""
    
    def _build_integration_test_prompt(self, issue_dict: Dict[str, Any]) -> str:
        """Build integration test prompt for Claude Code SDK."""
        return f"""# Integration Test Execution
        
## Issue Details
**Title**: {issue_dict.get('title', 'No title')}
**Description**: {issue_dict.get('description', 'No description')}

## Implementation
{issue_dict.get('implementation', 'No implementation available')}

## Unit Tests
{issue_dict.get('tests', 'No unit tests available')}

## Task
Please run integration tests for this implementation:

1. **System Integration**
   - Test integration with existing components
   - Verify system-wide functionality

2. **End-to-End Testing**
   - Test complete workflows
   - Verify user scenarios work correctly

3. **Performance Testing**
   - Check performance characteristics
   - Identify potential bottlenecks

4. **Compatibility Testing**
   - Test with different environments
   - Verify backward compatibility

Please provide comprehensive integration test results and identify any issues.
"""
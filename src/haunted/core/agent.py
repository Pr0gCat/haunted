"""Claude AI Agent for processing issues."""

import json
from typing import List, Dict, Any, Optional
from anthropic import AsyncAnthropic

from ..models import Issue, Task, TestResult, TaskStatus, TestType, TestStatus
from ..utils.logger import get_logger

logger = get_logger(__name__)


class ClaudeAgent:
    """Claude AI agent for autonomous development tasks."""
    
    def __init__(self, api_key: str, model: str = "claude-3-sonnet-20240229"):
        """
        Initialize Claude agent.
        
        Args:
            api_key: Anthropic API key
            model: Model to use (default: claude-3-sonnet)
        """
        self.client = AsyncAnthropic(api_key=api_key)
        self.model = model
        self.max_tokens = 4000
    
    async def analyze_and_plan(self, issue: Issue) -> str:
        """
        Analyze issue and create implementation plan.
        
        Based on DEVELOPMENT_WORKFLOW.md Plan stage:
        - Analyze requirements and problem definition
        - Design solution architecture
        - Determine implementation scope
        - Identify potential risks
        - Create implementation strategy
        
        Args:
            issue: Issue to analyze
            
        Returns:
            Implementation plan as string
        """
        prompt = self._build_plan_prompt(issue)
        
        response = await self.client.messages.create(
            model=self.model,
            max_tokens=self.max_tokens,
            messages=[
                {"role": "user", "content": prompt}
            ],
            tools=self._get_mcp_tools()
        )
        
        plan = response.content[0].text if response.content else ""
        logger.info(f"Created plan for issue {issue.id}")
        return plan
    
    async def implement_solution(self, issue: Issue) -> List[Task]:
        """
        Implement solution based on plan.
        
        Based on DEVELOPMENT_WORKFLOW.md Implement stage:
        - Write code according to plan
        - Focus on core functionality
        - Follow existing code conventions
        - Ensure code readability
        
        Args:
            issue: Issue to implement
            
        Returns:
            List of created tasks
        """
        prompt = self._build_implement_prompt(issue)
        
        response = await self.client.messages.create(
            model=self.model,
            max_tokens=self.max_tokens,
            messages=[
                {"role": "user", "content": prompt}
            ],
            tools=self._get_mcp_tools()
        )
        
        # Parse tasks from response
        tasks = self._parse_tasks_from_response(issue.id, response)
        logger.info(f"Created {len(tasks)} tasks for issue {issue.id}")
        return tasks
    
    async def write_and_run_unit_tests(self, issue: Issue) -> TestResult:
        """
        Write and run unit tests for implementation.
        
        Based on DEVELOPMENT_WORKFLOW.md Unit Test stage:
        - Write unit tests for new functionality
        - Test individual functions and components
        - Verify edge cases and error handling
        - Ensure code logic correctness
        
        Args:
            issue: Issue to test
            
        Returns:
            Test result
        """
        prompt = self._build_unit_test_prompt(issue)
        
        response = await self.client.messages.create(
            model=self.model,
            max_tokens=self.max_tokens,
            messages=[
                {"role": "user", "content": prompt}
            ],
            tools=self._get_mcp_tools()
        )
        
        # Parse test result from response
        test_result = self._parse_test_result(issue.id, response, TestType.UNIT)
        logger.info(f"Unit tests {test_result.status} for issue {issue.id}")
        return test_result
    
    async def fix_test_failures(self, issue: Issue, test_results: List[TestResult]) -> None:
        """
        Fix failing tests.
        
        Based on DEVELOPMENT_WORKFLOW.md Fix Issues stage:
        - Diagnose and fix problems if tests fail
        - Re-run tests until all pass
        - Refactor code to improve quality
        
        Args:
            issue: Issue with failing tests
            test_results: Failed test results
        """
        prompt = self._build_fix_prompt(issue, test_results)
        
        await self.client.messages.create(
            model=self.model,
            max_tokens=self.max_tokens,
            messages=[
                {"role": "user", "content": prompt}
            ],
            tools=self._get_mcp_tools()
        )
        
        logger.info(f"Applied fixes for issue {issue.id}")
    
    async def run_integration_tests(self, issue: Issue) -> TestResult:
        """
        Run integration tests.
        
        Based on DEVELOPMENT_WORKFLOW.md Integration Test stage:
        - Write integration tests for system integration
        - Test interaction with existing system
        - Verify end-to-end workflow
        - Confirm original problem is solved
        
        Args:
            issue: Issue to test
            
        Returns:
            Test result
        """
        prompt = self._build_integration_test_prompt(issue)
        
        response = await self.client.messages.create(
            model=self.model,
            max_tokens=self.max_tokens,
            messages=[
                {"role": "user", "content": prompt}
            ],
            tools=self._get_mcp_tools()
        )
        
        test_result = self._parse_test_result(issue.id, response, TestType.INTEGRATION)
        logger.info(f"Integration tests {test_result.status} for issue {issue.id}")
        return test_result
    
    async def diagnose_failure(self, issue: Issue, test_results: List[TestResult]) -> str:
        """
        Diagnose test failures.
        
        Based on DEVELOPMENT_WORKFLOW.md Diagnose stage:
        - Diagnose failure reasons
        - Document problems and findings
        - Analyze root causes
        - Create problem report
        
        Args:
            issue: Issue with failures
            test_results: All test results
            
        Returns:
            Diagnosis report
        """
        prompt = self._build_diagnose_prompt(issue, test_results)
        
        response = await self.client.messages.create(
            model=self.model,
            max_tokens=self.max_tokens,
            messages=[
                {"role": "user", "content": prompt}
            ]
        )
        
        diagnosis = response.content[0].text if response.content else ""
        logger.info(f"Created diagnosis for issue {issue.id}")
        return diagnosis
    
    def _build_plan_prompt(self, issue: Issue) -> str:
        """Build prompt for planning stage."""
        prompt = f"""根據以下 Issue 進行計劃階段的工作：

標題：{issue.title}
描述：{issue.description}
優先級：{issue.priority}

請進行：
1. 分析需求和問題定義
2. 設計解決方案架構
3. 確定實作範圍和邊界
4. 識別潛在風險和依賴項
5. 制定實作策略

輸出詳細的實作計劃。"""
        
        if issue.iteration_count > 0 and issue.diagnosis_log:
            prompt += f"\n\n這是第 {issue.iteration_count + 1} 次迭代，請參考之前的診斷記錄：\n{issue.diagnosis_log}"
        
        return prompt
    
    def _build_implement_prompt(self, issue: Issue) -> str:
        """Build prompt for implementation stage."""
        return f"""根據計劃實作以下 Issue：

標題：{issue.title}
計劃：{issue.plan}

要求：
- 根據計劃編寫程式碼
- 專注於核心功能實現
- 遵循現有程式碼慣例和模式
- 確保程式碼可讀性和維護性

使用提供的 MCP 工具來實作解決方案。
完成後，以 JSON 格式返回創建的任務列表。"""
    
    def _build_unit_test_prompt(self, issue: Issue) -> str:
        """Build prompt for unit testing stage."""
        return f"""為 Issue #{issue.id} 的實作撰寫並執行單元測試：

要求：
- 為新實作的功能撰寫單元測試
- 測試個別函數、方法和組件的行為
- 驗證邊界條件和錯誤處理
- 確保程式碼邏輯正確性

使用 MCP 工具撰寫測試並執行。
返回測試結果（passed/failed）和任何錯誤訊息。"""
    
    def _build_fix_prompt(self, issue: Issue, test_results: List[TestResult]) -> str:
        """Build prompt for fixing stage."""
        failed_tests = [t for t in test_results if t.status == TestStatus.FAILED]
        errors = "\n".join([f"- {t.test_name}: {t.error_log}" for t in failed_tests])
        
        return f"""修復 Issue #{issue.id} 的測試失敗：

失敗的測試：
{errors}

要求：
- 診斷並修復問題
- 確保所有測試通過
- 必要時重構程式碼以提高品質

使用 MCP 工具修復程式碼。"""
    
    def _build_integration_test_prompt(self, issue: Issue) -> str:
        """Build prompt for integration testing stage."""
        return f"""為 Issue #{issue.id} 執行整合測試：

要求：
- 撰寫整合測試驗證系統整合
- 測試與現有系統的互動
- 驗證端到端工作流程
- 確認解決了原始問題

使用 MCP 工具執行整合測試。
返回測試結果和任何問題。"""
    
    def _build_diagnose_prompt(self, issue: Issue, test_results: List[TestResult]) -> str:
        """Build prompt for diagnosis stage."""
        failed_tests = [t for t in test_results if t.status == TestStatus.FAILED]
        
        return f"""診斷 Issue #{issue.id} 的測試失敗：

失敗的測試數量：{len(failed_tests)}
迭代次數：{issue.iteration_count + 1}

請提供詳細診斷報告，包括：
1. 失敗的測試案例分析
2. 錯誤訊息和堆疊追蹤
3. 預期行為與實際行為對比
4. 可能的解決方向
5. 系統影響分析

這個診斷將用於下一次計劃階段的參考。"""
    
    def _get_mcp_tools(self) -> List[Dict[str, Any]]:
        """Get MCP tool definitions for Claude."""
        return [
            {
                "name": "read_file",
                "description": "Read file contents",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "File path"}
                    },
                    "required": ["path"]
                }
            },
            {
                "name": "write_file",
                "description": "Write or modify file",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "File path"},
                        "content": {"type": "string", "description": "File content"}
                    },
                    "required": ["path", "content"]
                }
            },
            {
                "name": "run_command",
                "description": "Execute shell command",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "command": {"type": "string", "description": "Command to execute"}
                    },
                    "required": ["command"]
                }
            },
            {
                "name": "git_operation",
                "description": "Perform git operations",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "operation": {"type": "string", "description": "Git operation"},
                        "args": {"type": "array", "items": {"type": "string"}}
                    },
                    "required": ["operation"]
                }
            }
        ]
    
    def _parse_tasks_from_response(self, issue_id: str, response) -> List[Task]:
        """Parse tasks from Claude's response."""
        tasks = []
        
        # Try to extract JSON from response
        try:
            content = response.content[0].text if response.content else "[]"
            # Find JSON in the response
            import re
            json_match = re.search(r'\[.*\]', content, re.DOTALL)
            if json_match:
                task_data = json.loads(json_match.group())
                for i, desc in enumerate(task_data):
                    if isinstance(desc, dict):
                        desc = desc.get("description", str(desc))
                    task = Task(
                        id=f"{issue_id}-task-{i+1}",
                        issue_id=issue_id,
                        description=str(desc),
                        status=TaskStatus.PENDING
                    )
                    tasks.append(task)
        except Exception as e:
            logger.error(f"Failed to parse tasks: {e}")
            # Create a default task
            task = Task(
                id=f"{issue_id}-task-1",
                issue_id=issue_id,
                description="Implement solution",
                status=TaskStatus.PENDING
            )
            tasks.append(task)
        
        return tasks
    
    def _parse_test_result(self, issue_id: str, response, test_type: TestType) -> TestResult:
        """Parse test result from Claude's response."""
        import time
        
        # Default to failed
        status = TestStatus.FAILED
        error_log = None
        
        try:
            content = response.content[0].text if response.content else ""
            
            # Look for pass/fail indicators
            if "passed" in content.lower() or "success" in content.lower():
                status = TestStatus.PASSED
            elif "failed" in content.lower() or "error" in content.lower():
                status = TestStatus.FAILED
                # Extract error information
                lines = content.split('\n')
                error_lines = [l for l in lines if 'error' in l.lower() or 'fail' in l.lower()]
                error_log = '\n'.join(error_lines[:5])  # First 5 error lines
        except Exception as e:
            logger.error(f"Failed to parse test result: {e}")
            error_log = str(e)
        
        return TestResult(
            id=f"{issue_id}-test-{int(time.time())}",  # Use timestamp-based ID
            issue_id=issue_id,
            test_type=test_type,
            status=status,
            error_log=error_log
        )
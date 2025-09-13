/**
 * Claude Code CLI Wrapper - Provides interface to Claude Code CLI
 */

import { execa } from 'execa';
import type { Issue } from '../models/index.js';
import { logger } from '../utils/logger.js';

export class ClaudeCodeWrapper {
  private claudeCommand: string = 'claude';

  constructor(command: string = 'claude') {
    this.claudeCommand = command;
  }

  async checkAvailability(): Promise<boolean> {
    try {
      const result = await execa(this.claudeCommand, ['--version'], {
        timeout: 10000
      });

      if (result.exitCode === 0) {
        logger.info('Claude Code CLI is available');
        return true;
      } else {
        logger.warn(`Claude CLI check failed with exit code: ${result.exitCode}`);
        return false;
      }
    } catch (error) {
      logger.warn('Claude CLI check failed:', error);
      return false;
    }
  }

  async analyzeAndPlan(issue: Issue): Promise<any> {
    const prompt = this.buildPlanPrompt(issue);

    try {
      const response = await this.executeClaudeQuery(
        prompt,
        'You are an expert software architect analyzing issues and creating implementation plans.'
      );

      logger.info(`Generated plan for issue ${issue.id}`);
      return response;
    } catch (error) {
      logger.error(`Plan generation failed for issue ${issue.id}:`, error);
      return { error: `Plan generation failed: ${error}` };
    }
  }

  async implementSolution(issue: Issue): Promise<any> {
    const prompt = this.buildImplementPrompt(issue);

    try {
      const response = await this.executeClaudeQuery(
        prompt,
        'You are an expert software developer implementing solutions based on plans.'
      );

      logger.info(`Generated implementation for issue ${issue.id}`);
      return response;
    } catch (error) {
      logger.error(`Implementation failed for issue ${issue.id}:`, error);
      return { error: `Implementation failed: ${error}` };
    }
  }

  async diagnoseIssue(issue: Issue): Promise<any> {
    const prompt = this.buildDiagnosisPrompt(issue);

    try {
      const response = await this.executeClaudeQuery(
        prompt,
        'You are an expert software engineer diagnosing issues and identifying root causes.'
      );

      logger.info(`Generated diagnosis for issue ${issue.id}`);
      return response;
    } catch (error) {
      logger.error(`Diagnosis failed for issue ${issue.id}:`, error);
      return { error: `Diagnosis failed: ${error}` };
    }
  }

  private async executeClaudeQuery(prompt: string, systemPrompt: string): Promise<any> {
    try {
      // Combine system prompt and user prompt for modern Claude Code CLI
      const combinedPrompt = `${systemPrompt}\n\n${prompt}`;

      // Use Claude Code CLI to execute the query
      const result = await execa(this.claudeCommand, [
        'chat',
        combinedPrompt
      ], {
        timeout: 300000, // 5 minutes timeout
        encoding: 'utf8'
      });

      if (result.exitCode !== 0) {
        throw new Error(`Claude CLI failed with exit code ${result.exitCode}: ${result.stderr}`);
      }

      return this.parseClaudeResponse(result.stdout);
    } catch (error) {
      logger.error('Claude execution failed:', error);
      throw error;
    }
  }

  private parseClaudeResponse(output: string): any {
    try {
      // Try to parse as JSON first
      return JSON.parse(output);
    } catch {
      // If not JSON, return as text response
      return {
        type: 'text',
        content: output.trim(),
        timestamp: new Date().toISOString()
      };
    }
  }

  private buildPlanPrompt(issue: Issue): string {
    return `
Please analyze this issue and create a detailed implementation plan:

**Issue Details:**
- Title: ${issue.title}
- Description: ${issue.description}
- Priority: ${issue.priority}
- Current Status: ${issue.status}
- Workflow Stage: ${issue.workflowStage}

**Instructions:**
1. Analyze the issue and understand the requirements
2. Break down the implementation into clear, actionable steps
3. Identify any dependencies or prerequisites
4. Consider potential risks and mitigation strategies
5. Estimate the complexity and effort required

Please provide your response in JSON format with the following structure:
{
  "analysis": "Your analysis of the issue",
  "plan": {
    "steps": [
      {
        "id": 1,
        "title": "Step title",
        "description": "Detailed description",
        "dependencies": [],
        "estimatedEffort": "time estimate"
      }
    ],
    "risks": ["potential risk 1", "potential risk 2"],
    "prerequisites": ["prerequisite 1", "prerequisite 2"],
    "complexity": "low|medium|high|critical"
  },
  "recommendations": ["recommendation 1", "recommendation 2"]
}
`.trim();
  }

  private buildImplementPrompt(issue: Issue): string {
    return `
Please implement a solution for this issue based on the existing plan:

**Issue Details:**
- Title: ${issue.title}
- Description: ${issue.description}
- Priority: ${issue.priority}
- Current Plan: ${issue.plan || 'No plan available'}

**Instructions:**
1. Follow the implementation plan if available
2. Write clean, maintainable code
3. Include appropriate error handling
4. Add comments where necessary
5. Consider testing requirements

Please provide your response in JSON format with the following structure:
{
  "implementation": {
    "files": [
      {
        "path": "file/path",
        "content": "file content",
        "action": "create|modify|delete"
      }
    ],
    "commands": [
      {
        "description": "Command description",
        "command": "actual command to run"
      }
    ],
    "tests": [
      {
        "type": "unit|integration|e2e",
        "description": "Test description",
        "file": "test file path",
        "content": "test content"
      }
    ]
  },
  "notes": "Implementation notes and considerations",
  "nextSteps": ["next step 1", "next step 2"]
}
`.trim();
  }

  private buildDiagnosisPrompt(issue: Issue): string {
    return `
Please diagnose this issue and identify the root cause:

**Issue Details:**
- Title: ${issue.title}
- Description: ${issue.description}
- Priority: ${issue.priority}
- Current Status: ${issue.status}
- Previous Diagnosis: ${issue.diagnosisLog || 'None'}

**Instructions:**
1. Analyze the issue description and symptoms
2. Identify potential root causes
3. Suggest diagnostic steps to verify the cause
4. Recommend solutions or workarounds

Please provide your response in JSON format with the following structure:
{
  "diagnosis": {
    "symptoms": ["symptom 1", "symptom 2"],
    "rootCauses": [
      {
        "cause": "Root cause description",
        "likelihood": "high|medium|low",
        "evidence": "Supporting evidence"
      }
    ],
    "diagnosticSteps": [
      {
        "step": "Diagnostic step description",
        "command": "command to run (if applicable)",
        "expectedResult": "what to look for"
      }
    ]
  },
  "recommendations": [
    {
      "solution": "Solution description",
      "priority": "high|medium|low",
      "effort": "effort estimate"
    }
  ],
  "notes": "Additional notes and considerations"
}
`.trim();
  }

  async executeDiagnosticCommand(command: string, workingDir?: string): Promise<any> {
    try {
      const result = await execa('sh', ['-c', command], {
        cwd: workingDir || process.cwd(),
        timeout: 30000,
        encoding: 'utf8'
      });

      return {
        success: result.exitCode === 0,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr
      };
    } catch (error: any) {
      return {
        success: false,
        exitCode: error.exitCode || -1,
        stdout: error.stdout || '',
        stderr: error.stderr || error.message,
        error: error.message
      };
    }
  }
}
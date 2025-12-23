/**
 * Claude Service - Wraps Claude Code CLI for AI-powered development
 */

import { execa } from 'execa';
import { logger } from '../../utils/logger.js';
import type { TrackedIssue } from '../../models/index.js';

export interface ClaudeResponse {
  success: boolean;
  content: string;
  error?: string;
}

export interface PlanResult {
  analysis: string;
  plan: {
    steps: Array<{
      id: number;
      title: string;
      description: string;
      files?: string[];
    }>;
    estimatedComplexity: 'low' | 'medium' | 'high';
  };
  questions?: string[];
}

export interface ImplementationResult {
  success: boolean;
  filesChanged: string[];
  summary: string;
  error?: string;
}

export interface ReviewResponse {
  addressed: boolean;
  changes: string[];
  response: string;
}

export class ClaudeService {
  private claudeCommand: string = 'claude';
  private timeout: number = 300000; // 5 minutes

  constructor(options: { command?: string; timeout?: number } = {}) {
    if (options.command) {
      this.claudeCommand = options.command;
    }
    if (options.timeout) {
      this.timeout = options.timeout;
    }
  }

  /**
   * Check if Claude Code CLI is available
   */
  async checkAvailability(): Promise<boolean> {
    try {
      const result = await execa(this.claudeCommand, ['--version'], { timeout: 10000 });
      logger.info(`Claude Code CLI available: ${result.stdout.trim()}`);
      return result.exitCode === 0;
    } catch (error) {
      logger.warn('Claude Code CLI not available:', error);
      return false;
    }
  }

  /**
   * Execute a Claude Code query with a prompt
   */
  async query(prompt: string, options: {
    workingDir?: string;
    allowedTools?: string[];
  } = {}): Promise<ClaudeResponse> {
    try {
      const args = ['--print', prompt];

      // Add allowed tools if specified
      if (options.allowedTools?.length) {
        args.push('--allowedTools', options.allowedTools.join(','));
      }

      const result = await execa(this.claudeCommand, args, {
        cwd: options.workingDir || process.cwd(),
        timeout: this.timeout,
        encoding: 'utf8',
      });

      return {
        success: result.exitCode === 0,
        content: result.stdout,
        error: result.stderr || undefined,
      };
    } catch (error: any) {
      logger.error('Claude query failed:', error);
      return {
        success: false,
        content: '',
        error: error.message || String(error),
      };
    }
  }

  /**
   * Run Claude Code interactively on a task
   */
  async runTask(task: string, options: {
    workingDir?: string;
    maxTurns?: number;
  } = {}): Promise<ClaudeResponse> {
    try {
      const args = ['--print', '--max-turns', String(options.maxTurns || 10), task];

      const result = await execa(this.claudeCommand, args, {
        cwd: options.workingDir || process.cwd(),
        timeout: this.timeout,
        encoding: 'utf8',
      });

      return {
        success: result.exitCode === 0,
        content: result.stdout,
        error: result.stderr || undefined,
      };
    } catch (error: any) {
      logger.error('Claude task failed:', error);
      return {
        success: false,
        content: '',
        error: error.message || String(error),
      };
    }
  }

  /**
   * Analyze an issue and create an implementation plan
   */
  async analyzeAndPlan(issue: TrackedIssue, workingDir: string): Promise<PlanResult | null> {
    const prompt = `
You are analyzing a GitHub issue to create an implementation plan.

## Issue Details
- **Title**: ${issue.title}
- **Description**: ${issue.description}
- **Repository**: ${issue.repository}

## Instructions
1. Analyze the issue requirements carefully
2. Explore the codebase to understand the existing structure
3. Create a detailed implementation plan

Please provide:
1. A brief analysis of what needs to be done
2. Step-by-step implementation plan with specific files to modify/create
3. Any questions or clarifications needed before proceeding

Format your response clearly with sections for Analysis, Plan, and Questions (if any).
`.trim();

    const response = await this.runTask(prompt, { workingDir, maxTurns: 5 });

    if (!response.success) {
      logger.error('Planning failed:', response.error);
      return null;
    }

    // Parse the response into a structured plan
    return this.parsePlanResponse(response.content);
  }

  /**
   * Implement the planned solution
   */
  async implement(issue: TrackedIssue, plan: string, workingDir: string): Promise<ImplementationResult> {
    const prompt = `
You are implementing a solution for a GitHub issue.

## Issue Details
- **Title**: ${issue.title}
- **Description**: ${issue.description}

## Plan
${plan}

## Instructions
1. Follow the implementation plan
2. Create or modify the necessary files
3. Write clean, well-documented code
4. Add appropriate error handling
5. Create or update tests if applicable

Implement the solution now. Make all necessary file changes.
`.trim();

    const response = await this.runTask(prompt, { workingDir, maxTurns: 20 });

    if (!response.success) {
      return {
        success: false,
        filesChanged: [],
        summary: '',
        error: response.error,
      };
    }

    // Extract changed files from the response
    const filesChanged = this.extractChangedFiles(response.content);

    return {
      success: true,
      filesChanged,
      summary: response.content.slice(0, 500),
    };
  }

  /**
   * Respond to PR review comments
   */
  async handleReviewComments(
    comments: Array<{ path: string; body: string; line?: number }>,
    workingDir: string
  ): Promise<ReviewResponse> {
    const commentList = comments
      .map(c => `- **${c.path}${c.line ? `:${c.line}` : ''}**: ${c.body}`)
      .join('\n');

    const prompt = `
You are addressing PR review comments.

## Review Comments
${commentList}

## Instructions
1. Address each review comment
2. Make the requested changes to the code
3. Explain what changes you made for each comment

Please address all comments and make the necessary code changes.
`.trim();

    const response = await this.runTask(prompt, { workingDir, maxTurns: 15 });

    if (!response.success) {
      return {
        addressed: false,
        changes: [],
        response: response.error || 'Failed to address review comments',
      };
    }

    return {
      addressed: true,
      changes: this.extractChangedFiles(response.content),
      response: response.content.slice(0, 1000),
    };
  }

  /**
   * Run tests and fix any failures
   */
  async runTestsAndFix(testCommand: string, workingDir: string, maxAttempts: number = 3): Promise<{
    success: boolean;
    attempts: number;
    output: string;
  }> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Run tests
      const testResult = await this.executeCommand(testCommand, workingDir);

      if (testResult.success) {
        return {
          success: true,
          attempts: attempt,
          output: testResult.stdout,
        };
      }

      if (attempt < maxAttempts) {
        // Try to fix the failures
        const fixPrompt = `
The tests failed with the following output:

\`\`\`
${testResult.stderr || testResult.stdout}
\`\`\`

Please analyze the test failures and fix the code to make the tests pass.
`.trim();

        await this.runTask(fixPrompt, { workingDir, maxTurns: 10 });
      }
    }

    return {
      success: false,
      attempts: maxAttempts,
      output: 'Tests failed after maximum attempts',
    };
  }

  /**
   * Execute a shell command
   */
  async executeCommand(command: string, workingDir?: string): Promise<{
    success: boolean;
    exitCode: number;
    stdout: string;
    stderr: string;
  }> {
    try {
      const result = await execa('sh', ['-c', command], {
        cwd: workingDir || process.cwd(),
        timeout: 60000,
        encoding: 'utf8',
      });

      return {
        success: result.exitCode === 0,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    } catch (error: any) {
      return {
        success: false,
        exitCode: error.exitCode || -1,
        stdout: error.stdout || '',
        stderr: error.stderr || error.message,
      };
    }
  }

  /**
   * Parse plan response into structured format
   */
  private parsePlanResponse(content: string): PlanResult {
    // Simple parsing - in production, this could be more sophisticated
    const lines = content.split('\n');
    const steps: PlanResult['plan']['steps'] = [];
    let analysis = '';
    const questions: string[] = [];

    let section = '';
    let stepId = 1;

    for (const line of lines) {
      const lower = line.toLowerCase().trim();

      if (lower.includes('analysis') || lower.includes('overview')) {
        section = 'analysis';
      } else if (lower.includes('plan') || lower.includes('steps')) {
        section = 'plan';
      } else if (lower.includes('question')) {
        section = 'questions';
      } else if (line.match(/^\d+\.|^-\s/)) {
        if (section === 'plan') {
          steps.push({
            id: stepId++,
            title: line.replace(/^\d+\.\s*|-\s*/, '').trim(),
            description: '',
          });
        } else if (section === 'questions') {
          questions.push(line.replace(/^\d+\.\s*|-\s*/, '').trim());
        }
      } else if (section === 'analysis') {
        analysis += line + '\n';
      }
    }

    return {
      analysis: analysis.trim() || content.slice(0, 500),
      plan: {
        steps: steps.length > 0 ? steps : [{ id: 1, title: 'Implement solution', description: content }],
        estimatedComplexity: steps.length > 5 ? 'high' : steps.length > 2 ? 'medium' : 'low',
      },
      questions: questions.length > 0 ? questions : undefined,
    };
  }

  /**
   * Extract changed files from Claude response
   */
  private extractChangedFiles(content: string): string[] {
    const files: Set<string> = new Set();

    // Look for file paths in various formats
    const patterns = [
      /(?:created?|modified?|updated?|changed?|wrote)\s+[`"]?([^\s`"]+\.[a-z]+)[`"]?/gi,
      /File:\s*[`"]?([^\s`"]+\.[a-z]+)[`"]?/gi,
      /```(?:[\w]+)?\s*\n\/\/\s*([^\n]+\.[a-z]+)/gi,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const file = match[1].trim();
        if (file && !file.includes(' ') && file.includes('.')) {
          files.add(file);
        }
      }
    }

    return Array.from(files);
  }
}

export default ClaudeService;

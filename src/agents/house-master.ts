import { BaseAgent, type AgentResult, type AgentContext } from "@/agents/base-agent.ts";
import { createLogger } from "@/utils/logger.ts";
import type { Config, LabelsConfig } from "@/config/schema.ts";
import type { Issue, IssueComment } from "@/github/issues.ts";
import { isAgentComment } from "@/github/comments.ts";
import type { PullRequest } from "@/github/pull-requests.ts";

const logger = createLogger("house-master");

export interface IssueAnalysis {
  type: "bug" | "feature" | "enhancement" | "documentation" | "question" | "refactor" | "test" | "chore" | "unknown";
  complexity: "low" | "medium" | "high";
  priority: "critical" | "high" | "medium" | "low";
  shouldSplit: boolean;
  subtasks: string[];
  suggestedLabels: string[];
  assignTo: "ai" | "human";
  needsClarification: boolean;
  clarificationQuestion?: string;
  reasoning: string;
}

export interface CodeReviewResult {
  approved: boolean;
  comments: string[];
  suggestedChanges: string[];
  overallFeedback: string;
}

export class HouseMasterAgent extends BaseAgent {
  private config: Config;

  constructor(config: Config) {
    super("HouseMaster");
    this.config = config;
  }

  async execute(context: AgentContext): Promise<AgentResult> {
    return this.runClaudeCode(context.workDir, context.task, {
      print: true,
      systemPrompt: context.systemPrompt,
    });
  }

  async analyzeIssue(issue: Issue, repoPath: string, comments: IssueComment[] = []): Promise<IssueAnalysis> {
    const labelsConfig = this.config.labels;
    const availableTypes = Object.keys(labelsConfig.issue_types).join(" | ");
    const availableComplexity = Object.keys(labelsConfig.complexity).join(" | ");
    const availablePriority = Object.keys(labelsConfig.priority).join(" | ");

    // Filter out agent comments and format user comments
    const userComments = comments
      .filter((c) => !isAgentComment(c.body))
      .map((c) => `@${c.author} (${c.createdAt}):\n${c.body}`)
      .join("\n\n---\n\n");

    const commentsSection = userComments
      ? `\n\n## Comments from users:\n\n${userComments}`
      : "";

    const prompt = `Analyze this GitHub issue and provide a structured analysis.

Issue #${issue.number}: ${issue.title}

${issue.body}${commentsSection}

Current Labels: ${issue.labels.join(", ") || "none"}

Available issue type labels: ${Object.entries(labelsConfig.issue_types)
      .map(([key, val]) => `${key} -> "${val.name}"`)
      .join(", ")}

Respond with ONLY a JSON object in this exact format:
{
  "type": "${availableTypes} | unknown",
  "complexity": "${availableComplexity}",
  "priority": "${availablePriority}",
  "shouldSplit": boolean,
  "subtasks": ["subtask1", "subtask2"] or [],
  "suggestedLabels": ["exact-label-name-1", "exact-label-name-2"] or [],
  "assignTo": "ai" | "human",
  "needsClarification": boolean,
  "clarificationQuestion": "question to ask if needsClarification is true",
  "reasoning": "brief explanation of your analysis"
}

IMPORTANT:
- For suggestedLabels, use the exact label names that will be applied to GitHub.
- Set needsClarification to true if the issue lacks specific details needed for implementation.
- When needsClarification is true, provide a clear clarificationQuestion asking for the missing details.`;

    const systemPrompt = this.getAnalysisSystemPrompt(labelsConfig);

    // Use interactive mode for faster response (session reuse)
    const result = await this.runClaudeCodeInteractive(repoPath, prompt, {
      systemPrompt,
      timeout: 600000, // 10 minutes for analysis
      reuseSession: true, // Reuse session for multiple analyses
    });

    if (!result.success) {
      logger.error({ error: result.error }, "Failed to analyze issue");
      return this.getDefaultAnalysis();
    }

    try {
      const jsonMatch = result.output.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in output");
      }

      const rawAnalysis = JSON.parse(jsonMatch[0]) as IssueAnalysis;

      // Convert type/complexity/priority to actual label names
      const analysis = this.enrichAnalysisWithLabels(rawAnalysis, labelsConfig);

      logger.info({ issueNumber: issue.number, analysis }, "Issue analyzed");
      return analysis;
    } catch (error) {
      logger.error({ error, output: result.output }, "Failed to parse analysis");
      return this.getDefaultAnalysis();
    }
  }

  private enrichAnalysisWithLabels(analysis: IssueAnalysis, labelsConfig: LabelsConfig): IssueAnalysis {
    const suggestedLabels = [...analysis.suggestedLabels];

    // Add type label
    const typeLabel = labelsConfig.issue_types[analysis.type];
    if (typeLabel && !suggestedLabels.includes(typeLabel.name)) {
      suggestedLabels.push(typeLabel.name);
    }

    // Add complexity label
    const complexityLabel = labelsConfig.complexity[analysis.complexity];
    if (complexityLabel && !suggestedLabels.includes(complexityLabel.name)) {
      suggestedLabels.push(complexityLabel.name);
    }

    // Add priority label for high/critical priority issues
    if (analysis.priority === "critical" || analysis.priority === "high") {
      const priorityLabel = labelsConfig.priority[analysis.priority];
      if (priorityLabel && !suggestedLabels.includes(priorityLabel.name)) {
        suggestedLabels.push(priorityLabel.name);
      }
    }

    return {
      ...analysis,
      suggestedLabels,
    };
  }

  async reviewPullRequest(pr: PullRequest, diff: string, repoPath: string): Promise<CodeReviewResult> {
    const prompt = `Review this pull request and provide feedback.

PR #${pr.number}: ${pr.title}

Description:
${pr.body || "No description provided"}

Branch: ${pr.headBranch} -> ${pr.baseBranch}

Diff:
\`\`\`diff
${diff.slice(0, 50000)}
\`\`\`

Respond with ONLY a JSON object in this exact format:
{
  "approved": boolean,
  "comments": ["comment1", "comment2"] or [],
  "suggestedChanges": ["change1", "change2"] or [],
  "overallFeedback": "your overall assessment"
}`;

    const systemPrompt = this.getReviewSystemPrompt();

    // Use interactive mode for faster response
    const result = await this.runClaudeCodeInteractive(repoPath, prompt, {
      systemPrompt,
      timeout: 600000, // 10 minutes for PR review
      reuseSession: true,
    });

    if (!result.success) {
      logger.error({ error: result.error }, "Failed to review PR");
      return this.getDefaultReview();
    }

    try {
      const jsonMatch = result.output.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in output");
      }

      const review = JSON.parse(jsonMatch[0]) as CodeReviewResult;
      logger.info({ prNumber: pr.number, approved: review.approved }, "PR reviewed");
      return review;
    } catch (error) {
      logger.error({ error, output: result.output }, "Failed to parse review");
      return this.getDefaultReview();
    }
  }

  async generateResponse(context: string, question: string, repoPath: string): Promise<string> {
    const prompt = `${context}

Question/Request: ${question}

Provide a helpful and concise response.`;

    // Use interactive mode for faster response
    const result = await this.runClaudeCodeInteractive(repoPath, prompt, {
      systemPrompt: this.getResponseSystemPrompt(),
      timeout: 300000, // 5 minutes for response
      reuseSession: true,
    });

    if (!result.success) {
      return "I apologize, but I encountered an error processing your request.";
    }

    return result.output;
  }

  private getAnalysisSystemPrompt(labelsConfig: LabelsConfig): string {
    const typeLabels = Object.entries(labelsConfig.issue_types)
      .map(([key, val]) => `  - ${key}: ${val.description || val.name}`)
      .join("\n");

    return `You are House Master, the AI Project Manager for this repository.

Your role is to analyze issues and determine:
1. The type of issue - choose from the available types
2. The complexity level (low/medium/high)
3. The priority level (critical/high/medium/low)
4. Whether it should be split into subtasks
5. What labels should be applied
6. Whether AI can handle it or it needs human attention

Available issue types:
${typeLabels}

Guidelines for "assignTo" decision:
- Assign to "ai" for: clear bugs with reproduction steps, simple features, documentation tasks, refactoring
- Assign to "human" for: complex architectural decisions, security-sensitive changes, issues requiring domain expertise

Guidelines for "needsClarification":
- Set to true when the issue description is too vague to implement
- Set to true when critical details are missing (e.g., "update X" without specifying what to update)
- Provide a specific question asking for the missing information
- IMPORTANT: Check the comments section for additional context from users before deciding
- If users have provided clarification in comments, use that information and set needsClarification to false
- Examples of vague issues that need clarification:
  - "Fix the bug" (which bug? what's the expected behavior?)
  - "Update README" (what specifically should be updated?)
  - "Improve performance" (which part? what's the target?)

Guidelines for priority:
- critical: Production down, security vulnerabilities, data loss
- high: Major functionality broken, blocking issues
- medium: Important but not urgent, regular features/bugs
- low: Nice to have, minor improvements

Always respond with ONLY the JSON object, no additional text.`;
  }

  private getReviewSystemPrompt(): string {
    return `You are House Master, the AI Project Manager performing code review.

Review the code for:
1. Code quality and best practices
2. Potential bugs or issues
3. Performance concerns
4. Security vulnerabilities
5. Test coverage
6. Documentation

Be constructive and specific in your feedback. Approve if the code is acceptable, even with minor suggestions.

Always respond with ONLY the JSON object, no additional text.`;
  }

  private getResponseSystemPrompt(): string {
    return `You are House Master, the AI Project Manager for this repository.

You help with:
- Answering questions about the codebase
- Providing guidance on implementation
- Clarifying requirements
- Coordinating between team members and AI agents

Be helpful, concise, and professional.`;
  }

  private getDefaultAnalysis(): IssueAnalysis {
    return {
      type: "unknown",
      complexity: "medium",
      priority: "medium",
      shouldSplit: false,
      subtasks: [],
      suggestedLabels: [],
      assignTo: "ai",
      needsClarification: false,
      reasoning: "Default analysis due to processing error",
    };
  }

  private getDefaultReview(): CodeReviewResult {
    return {
      approved: false,
      comments: ["Unable to complete automated review"],
      suggestedChanges: [],
      overallFeedback: "Please request manual review",
    };
  }
}

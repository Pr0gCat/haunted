import { createLogger } from "@/utils/logger.ts";
import type { Config } from "@/config/schema.ts";
import { HouseMasterAgent } from "@/agents/house-master.ts";
import { ClaudeCodeAgentPool } from "@/agents/claude-code.ts";
import { getIssue, getIssueComments, addIssueComment, addIssueLabels, updateIssue } from "@/github/issues.ts";
import { createPullRequest, getPRDiff, addPRReview, getPullRequest } from "@/github/pull-requests.ts";
import { formatAgentComment } from "@/github/comments.ts";

const logger = createLogger("orchestrator");

export interface IssueTask {
  repo: string;
  number: number;
  title: string;
  body: string;
  labels: string[];
  author: string;
}

export interface PRTask {
  repo: string;
  number: number;
  title: string;
  body: string;
  headBranch: string;
  baseBranch: string;
  author: string;
}

export interface MentionTask {
  repo: string;
  issueNumber: number;
  commentId: number;
  body: string;
  author: string;
}

export interface CommandTask {
  repo: string;
  issueNumber: number;
  command: string;
  args: string[];
  author: string;
}

export interface PRRevisionTask {
  repo: string;
  prNumber: number;
  comment: string;
  author: string;
}

export class Orchestrator {
  private config: Config;
  private houseMaster: HouseMasterAgent;
  private claudeCodePool: ClaudeCodeAgentPool;
  private repoPath: string;
  private processingIssues: Set<string> = new Set();

  constructor(config: Config, repoPath: string) {
    this.config = config;
    this.repoPath = repoPath;
    this.houseMaster = new HouseMasterAgent(config);
    this.claudeCodePool = new ClaudeCodeAgentPool(config, repoPath, {
      maxWorkers: 3,
    });
  }

  async init(): Promise<void> {
    await this.claudeCodePool.init();
    logger.info("Orchestrator initialized");
  }

  async processIssue(task: IssueTask): Promise<void> {
    const issueKey = `${task.repo}:${task.number}`;

    if (this.processingIssues.has(issueKey)) {
      logger.warn({ issueKey }, "Issue already being processed");
      return;
    }

    this.processingIssues.add(issueKey);

    try {
      logger.info({ repo: task.repo, number: task.number }, "Processing issue");

      const [issue, comments] = await Promise.all([
        getIssue(task.repo, task.number),
        getIssueComments(task.repo, task.number),
      ]);

      const analysis = await this.houseMaster.analyzeIssue(issue, this.repoPath, comments);

      logger.info({ issueNumber: task.number, analysis }, "Issue analysis complete");

      // Silently add labels
      if (analysis.suggestedLabels.length > 0) {
        try {
          await addIssueLabels(task.repo, task.number, analysis.suggestedLabels);
        } catch (error) {
          logger.warn({ error }, "Failed to add labels");
        }
      }

      // Ask for clarification if requirements are unclear
      if (analysis.needsClarification && analysis.clarificationQuestion) {
        await addIssueComment(
          task.repo,
          task.number,
          formatAgentComment(
            "HouseMaster",
            `I need some clarification before I can work on this:\n\n${analysis.clarificationQuestion}\n\nPlease provide more details and I'll get started!`
          )
        );
        return;
      }

      // Only comment when human attention is needed
      if (analysis.assignTo === "human") {
        await addIssueComment(
          task.repo,
          task.number,
          formatAgentComment(
            "HouseMaster",
            `This issue requires human attention.\n\n**Reasoning:** ${analysis.reasoning}`
          )
        );
        return;
      }

      // Log subtask split but don't spam comments
      if (analysis.shouldSplit && analysis.subtasks.length > 0) {
        logger.info({ issueNumber: task.number, subtasks: analysis.subtasks }, "Issue should be split");
      }

      // Decide whether to create PR or commit directly to main based on requiresPR
      if (analysis.requiresPR) {
        // High-risk changes: create PR (existing behavior)
        const result = await this.claudeCodePool.executeTask(issue, task.repo);

        if (!result.success) {
          await addIssueComment(
            task.repo,
            task.number,
            formatAgentComment(
              "Haunted",
              `Implementation failed: ${result.error || "Unknown error"}\n\nA human developer may need to take a look.`
            )
          );
          return;
        }

        const prBody = this.formatPRDescription(result.summary, result.filesChanged, issue.number);
        const commitPrefix = this.getCommitPrefix(issue.labels);
        const pr = await createPullRequest({
          repo: task.repo,
          title: `${commitPrefix}: ${issue.title}`,
          body: prBody,
          head: result.branchName,
          base: "main",
        });

        await addIssueComment(
          task.repo,
          task.number,
          formatAgentComment("Haunted", `Created PR #${pr.number}`)
        );

        logger.info({ repo: task.repo, issueNumber: task.number, prNumber: pr.number }, "PR created for issue");
      } else {
        // Low-risk changes: commit directly to main
        logger.info({ issueNumber: task.number }, "Low-risk change, committing directly to main");

        const result = await this.claudeCodePool.executeTaskDirectToMain(issue, task.repo);

        if (!result.success) {
          await addIssueComment(
            task.repo,
            task.number,
            formatAgentComment(
              "Haunted",
              `Implementation failed: ${result.error || "Unknown error"}\n\nA human developer may need to take a look.`
            )
          );
          return;
        }

        // Close the issue directly since changes are committed to main
        await updateIssue({
          repo: task.repo,
          number: task.number,
          state: "closed",
        });

        await addIssueComment(
          task.repo,
          task.number,
          formatAgentComment(
            "Haunted",
            `✅ Changes committed directly to main.\n\n## Summary\n\n${result.summary}\n\n**Files changed:**\n${result.filesChanged.map((f) => `- ${f}`).join("\n")}`
          )
        );

        logger.info({ repo: task.repo, issueNumber: task.number }, "Low-risk change committed directly to main");
      }
    } catch (error) {
      logger.error({ error, issueKey }, "Failed to process issue");
      // Don't spam issue with error comments - just log it
    } finally {
      this.processingIssues.delete(issueKey);
    }
  }

  async reviewPullRequest(task: PRTask): Promise<void> {
    logger.info({ repo: task.repo, number: task.number }, "Reviewing PR");

    try {
      const pr = await getPullRequest(task.repo, task.number);
      const diff = await getPRDiff(task.repo, task.number);

      const review = await this.houseMaster.reviewPullRequest(pr, diff, this.repoPath);

      const event = review.approved ? "APPROVE" : "REQUEST_CHANGES";

      let reviewBody = review.overallFeedback;
      if (review.suggestedChanges.length > 0) {
        reviewBody += `\n\n**Suggestions:**\n${review.suggestedChanges.map((c) => `- ${c}`).join("\n")}`;
      }

      await addPRReview({
        repo: task.repo,
        number: task.number,
        event,
        body: reviewBody,
      });

      logger.info(
        { repo: task.repo, prNumber: task.number, approved: review.approved },
        "PR review submitted"
      );
    } catch (error) {
      logger.error({ error, repo: task.repo, prNumber: task.number }, "Failed to review PR");
    }
  }

  async cancelIssueProcessing(repo: string, issueNumber: number): Promise<void> {
    const issueKey = `${repo}:${issueNumber}`;

    if (this.processingIssues.has(issueKey)) {
      await this.claudeCodePool.cancelTask(repo, issueNumber);
      this.processingIssues.delete(issueKey);
      logger.info({ repo, issueNumber }, "Issue processing cancelled");
    }
  }

  async handlePRMerged(repo: string, prNumber: number): Promise<void> {
    logger.info({ repo, prNumber }, "Handling merged PR");
    // Cleanup worktrees and resources associated with this PR
  }

  async handleMention(task: MentionTask): Promise<void> {
    logger.info({ repo: task.repo, issueNumber: task.issueNumber }, "Handling mention");

    try {
      const issue = await getIssue(task.repo, task.issueNumber);
      const context = `Issue #${issue.number}: ${issue.title}\n\n${issue.body}\n\nUser ${task.author} commented:`;

      const response = await this.houseMaster.generateResponse(
        context,
        task.body,
        this.repoPath
      );

      await addIssueComment(
        task.repo,
        task.issueNumber,
        formatAgentComment("Haunted", response)
      );
    } catch (error) {
      logger.error({ error }, "Failed to handle mention");
    }
  }

  async handleCommand(task: CommandTask): Promise<void> {
    logger.info({ repo: task.repo, issueNumber: task.issueNumber, command: task.command }, "Handling command");

    const commands: Record<string, () => Promise<void>> = {
      retry: async () => {
        const issue = await getIssue(task.repo, task.issueNumber);
        await this.processIssue({
          repo: task.repo,
          number: issue.number,
          title: issue.title,
          body: issue.body,
          labels: issue.labels,
          author: issue.author,
        });
      },
      cancel: async () => {
        await this.cancelIssueProcessing(task.repo, task.issueNumber);
        await addIssueComment(
          task.repo,
          task.issueNumber,
          formatAgentComment("Haunted", "Cancelled.")
        );
      },
      status: async () => {
        const isProcessing = this.processingIssues.has(`${task.repo}:${task.issueNumber}`);
        const status = isProcessing ? "Processing" : "Idle";
        await addIssueComment(
          task.repo,
          task.issueNumber,
          formatAgentComment("Haunted", `Status: ${status}`)
        );
      },
    };

    const handler = commands[task.command];
    if (handler) {
      await handler();
    } else {
      // Unknown command - just ignore, don't spam
      logger.warn({ command: task.command }, "Unknown command");
    }
  }

  async handlePRRevisionRequest(task: PRRevisionTask): Promise<void> {
    const prKey = `pr:${task.repo}:${task.prNumber}`;

    if (this.processingIssues.has(prKey)) {
      logger.warn({ prKey }, "PR revision already in progress");
      return;
    }

    this.processingIssues.add(prKey);

    try {
      logger.info({ repo: task.repo, prNumber: task.prNumber }, "Processing PR revision request");

      const pr = await getPullRequest(task.repo, task.prNumber);

      // Only process PRs created by haunted
      if (!pr.headBranch.startsWith(this.config.agents.claude_code.branch_prefix)) {
        logger.info({ prNumber: task.prNumber }, "PR not created by haunted, skipping");
        return;
      }

      const result = await this.claudeCodePool.executeRevision(pr, task.repo, task.comment);

      if (!result.success) {
        await addIssueComment(
          task.repo,
          task.prNumber,
          formatAgentComment(
            "Haunted",
            `Failed to apply revision: ${result.error || "Unknown error"}`
          )
        );
        return;
      }

      await addIssueComment(
        task.repo,
        task.prNumber,
        formatAgentComment(
          "Haunted",
          `Applied revisions based on your feedback.\n\n**Changes:**\n${result.filesChanged.map((f) => `- ${f}`).join("\n")}`
        )
      );

      logger.info({ repo: task.repo, prNumber: task.prNumber }, "PR revision applied");
    } catch (error) {
      logger.error({ error, prKey }, "Failed to process PR revision");
    } finally {
      this.processingIssues.delete(prKey);
    }
  }

  async cleanup(): Promise<void> {
    await this.claudeCodePool.cleanup();
    this.processingIssues.clear();
    logger.info("Orchestrator cleaned up");
  }

  /**
   * Format PR description with detailed information about changes.
   * Parses the agent's summary output and combines with file change information.
   */
  private formatPRDescription(summary: string, filesChanged: string[], issueNumber: number): string {
    // Parse the summary to extract sections if they exist
    const summarySection = this.extractSection(summary, "## Summary") || summary;
    const changesSection = this.extractSection(summary, "## Changes");
    const testSection = this.extractSection(summary, "## Test Results");

    let body = `## Summary\n\n${summarySection.trim()}\n\n`;

    // Add changes section - prefer extracted from summary, fallback to filesChanged list
    body += `## Changes\n\n`;
    if (changesSection) {
      body += `${changesSection.trim()}\n\n`;
    } else if (filesChanged.length > 0) {
      body += filesChanged.map(f => `- **${f}**`).join("\n");
      body += "\n\n";
    }

    // Add test results if available
    if (testSection) {
      body += `## Test Results\n\n${testSection.trim()}\n\n`;
    }

    body += `Closes #${issueNumber}\n\n---\n🤖 *Generated by Haunted AI*`;

    return body;
  }

  /**
   * Extract a section from markdown text.
   * Returns content between the section header and the next header or end of text.
   * Uses regex to match headers at the start of a line to avoid false matches.
   */
  private extractSection(text: string, sectionHeader: string, headerLevel: number = 2): string | null {
    // Match the section header at the start of a line
    const headerPattern = new RegExp(`^${this.escapeRegex(sectionHeader)}\\s*$`, "m");
    const match = text.match(headerPattern);
    if (!match || match.index === undefined) return null;

    const contentStart = match.index + match[0].length;

    // Find the next header of the same or higher level (fewer or equal #)
    // e.g., for level 2 (##), match ## but not ###
    const nextHeaderPattern = new RegExp(`^#{1,${headerLevel}}\\s`, "m");
    const remainingText = text.slice(contentStart);
    const nextMatch = remainingText.match(nextHeaderPattern);

    if (!nextMatch || nextMatch.index === undefined) {
      return remainingText.trim();
    }

    return remainingText.slice(0, nextMatch.index).trim();
  }

  /**
   * Escape special regex characters in a string.
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /**
   * Get the appropriate conventional commit prefix based on issue labels.
   */
  private getCommitPrefix(labels: string[]): string {
    const labelSet = new Set(labels.map((l) => l.toLowerCase()));

    // Check for specific issue types
    if (labelSet.has("bug") || labelSet.has("fix") || labelSet.has("bugfix")) {
      return "fix";
    }
    if (labelSet.has("feature") || labelSet.has("enhancement")) {
      return "feat";
    }
    if (labelSet.has("docs") || labelSet.has("documentation")) {
      return "docs";
    }
    if (labelSet.has("refactor") || labelSet.has("refactoring")) {
      return "refactor";
    }
    if (labelSet.has("test") || labelSet.has("testing")) {
      return "test";
    }
    if (labelSet.has("style")) {
      return "style";
    }
    if (labelSet.has("perf") || labelSet.has("performance")) {
      return "perf";
    }
    if (labelSet.has("chore") || labelSet.has("maintenance")) {
      return "chore";
    }
    if (labelSet.has("ci") || labelSet.has("build")) {
      return "ci";
    }

    // Default to fix for backward compatibility
    return "fix";
  }
}

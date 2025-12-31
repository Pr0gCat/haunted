import { describe, it, expect, vi, beforeEach } from "vitest";
import { Orchestrator } from "./orchestrator.ts";
import type { Config } from "@/config/schema.ts";
import * as issues from "@/github/issues.ts";
import * as pullRequests from "@/github/pull-requests.ts";

// Mock all dependencies
vi.mock("@/github/issues.ts", () => ({
  getIssue: vi.fn(),
  getIssueComments: vi.fn(),
  addIssueComment: vi.fn(),
  addIssueLabels: vi.fn(),
}));

vi.mock("@/github/pull-requests.ts", () => ({
  createPullRequest: vi.fn(),
  getPRDiff: vi.fn(),
  addPRReview: vi.fn(),
  getPullRequest: vi.fn(),
}));

vi.mock("@/github/comments.ts", () => ({
  formatAgentComment: vi.fn((agent, msg) => `[${agent}] ${msg}`),
  isAgentComment: vi.fn(),
}));

const mockAnalyzeIssue = vi.fn();
const mockReviewPullRequest = vi.fn();
const mockGenerateResponse = vi.fn();
const mockExecuteTask = vi.fn();
const mockExecuteRevision = vi.fn();
const mockCancelTask = vi.fn();
const mockPoolInit = vi.fn();
const mockPoolCleanup = vi.fn();

vi.mock("@/agents/house-master.ts", () => ({
  HouseMasterAgent: class {
    analyzeIssue = mockAnalyzeIssue;
    reviewPullRequest = mockReviewPullRequest;
    generateResponse = mockGenerateResponse;
  },
}));

vi.mock("@/agents/claude-code.ts", () => ({
  ClaudeCodeAgentPool: class {
    init = mockPoolInit;
    executeTask = mockExecuteTask;
    executeRevision = mockExecuteRevision;
    cancelTask = mockCancelTask;
    cleanup = mockPoolCleanup;
  },
}));

vi.mock("@/utils/logger.ts", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("Orchestrator", () => {
  const mockConfig: Config = {
    version: "1.0",
    scope: { type: "repo", target: "test/repo" },
    github: {
      webhook: { enabled: false, port: 3000, secret: undefined },
      polling: { enabled: true, interval: 60 },
    },
    agents: {
      house_master: { enabled: true, auto_assign: true, auto_review: true },
      claude_code: { enabled: true, branch_prefix: "haunted/", auto_test: true },
    },
    pull_requests: {
      auto_merge: { enabled: false, require_approval: true, require_ci_pass: true },
      rules: [],
    },
    project: {
      enabled: true,
      columns: [
        { name: "Backlog", status: "backlog" },
        { name: "In Progress", status: "in_progress" },
        { name: "Review", status: "review" },
        { name: "Done", status: "done" },
      ],
    },
    labels: {
      human_only: "human-only",
      skip: "haunted-skip",
      auto_merge: "auto-merge",
      needs_review: "needs-review",
      issue_types: {},
      complexity: {},
      priority: {},
      auto_label: true,
    },
  };

  let orchestrator: Orchestrator;

  beforeEach(() => {
    vi.clearAllMocks();
    orchestrator = new Orchestrator(mockConfig, "/path/to/repo");
  });

  describe("processIssue", () => {
    it("should not process duplicate issues", async () => {
      const mockIssue = {
        number: 1,
        title: "Test",
        body: "Body",
        state: "open" as const,
        labels: [],
        assignees: [],
        author: "user",
        createdAt: "2025-01-01T00:00:00Z",
        updatedAt: "2025-01-01T00:00:00Z",
        url: "https://github.com/test/repo/issues/1",
      };

      vi.mocked(issues.getIssue).mockResolvedValue(mockIssue);
      vi.mocked(issues.getIssueComments).mockResolvedValue([]);

      mockAnalyzeIssue.mockResolvedValue({
        issueType: "feature",
        complexity: "medium",
        assignTo: "human",
        shouldSplit: false,
        subtasks: [],
        suggestedLabels: [],
        needsClarification: false,
        reasoning: "Needs human attention",
      });

      const task = {
        repo: "test/repo",
        number: 1,
        title: "Test",
        body: "Body",
        labels: [],
        author: "user",
      };

      // Start first processing (won't complete because we don't await)
      const first = orchestrator.processIssue(task);

      // Second call should return immediately
      const second = orchestrator.processIssue(task);

      await Promise.all([first, second]);

      // getIssue should only be called once
      expect(issues.getIssue).toHaveBeenCalledTimes(1);
    });

    it("should ask for clarification when needed", async () => {
      const mockIssue = {
        number: 1,
        title: "Vague issue",
        body: "Please fix",
        state: "open" as const,
        labels: [],
        assignees: [],
        author: "user",
        createdAt: "2025-01-01T00:00:00Z",
        updatedAt: "2025-01-01T00:00:00Z",
        url: "https://github.com/test/repo/issues/1",
      };

      vi.mocked(issues.getIssue).mockResolvedValue(mockIssue);
      vi.mocked(issues.getIssueComments).mockResolvedValue([]);

      mockAnalyzeIssue.mockResolvedValue({
        issueType: "feature",
        complexity: "low",
        assignTo: "ai",
        shouldSplit: false,
        subtasks: [],
        suggestedLabels: [],
        needsClarification: true,
        clarificationQuestion: "What exactly needs to be fixed?",
        reasoning: "Issue is too vague",
      });

      await orchestrator.processIssue({
        repo: "test/repo",
        number: 1,
        title: "Vague issue",
        body: "Please fix",
        labels: [],
        author: "user",
      });

      expect(issues.addIssueComment).toHaveBeenCalledWith(
        "test/repo",
        1,
        expect.stringContaining("clarification")
      );
    });

    it("should assign to human when analysis indicates", async () => {
      const mockIssue = {
        number: 1,
        title: "Complex issue",
        body: "Very complex",
        state: "open" as const,
        labels: [],
        assignees: [],
        author: "user",
        createdAt: "2025-01-01T00:00:00Z",
        updatedAt: "2025-01-01T00:00:00Z",
        url: "https://github.com/test/repo/issues/1",
      };

      vi.mocked(issues.getIssue).mockResolvedValue(mockIssue);
      vi.mocked(issues.getIssueComments).mockResolvedValue([]);

      mockAnalyzeIssue.mockResolvedValue({
        issueType: "bug",
        complexity: "high",
        assignTo: "human",
        shouldSplit: false,
        subtasks: [],
        suggestedLabels: ["bug", "complexity:high"],
        needsClarification: false,
        reasoning: "Requires human expertise",
      });

      await orchestrator.processIssue({
        repo: "test/repo",
        number: 1,
        title: "Complex issue",
        body: "Very complex",
        labels: [],
        author: "user",
      });

      expect(issues.addIssueComment).toHaveBeenCalledWith(
        "test/repo",
        1,
        expect.stringContaining("human attention")
      );
    });
  });

  describe("handleCommand", () => {
    it("should handle status command", async () => {
      vi.mocked(issues.addIssueComment).mockResolvedValue();

      await orchestrator.handleCommand({
        repo: "test/repo",
        issueNumber: 1,
        command: "status",
        args: [],
        author: "user",
      });

      expect(issues.addIssueComment).toHaveBeenCalledWith(
        "test/repo",
        1,
        expect.stringContaining("Status")
      );
    });

    it("should ignore unknown commands", async () => {
      await orchestrator.handleCommand({
        repo: "test/repo",
        issueNumber: 1,
        command: "unknown",
        args: [],
        author: "user",
      });

      // Should not call addIssueComment for unknown commands
      expect(issues.addIssueComment).not.toHaveBeenCalled();
    });
  });

  describe("handlePRRevisionRequest", () => {
    it("should skip PRs not created by haunted", async () => {
      vi.mocked(pullRequests.getPullRequest).mockResolvedValue({
        number: 1,
        title: "External PR",
        body: "",
        state: "open",
        headBranch: "feature-branch", // Not starting with haunted/
        baseBranch: "main",
        author: "external",
        labels: [],
        isDraft: false,
        mergeable: "MERGEABLE",
        url: "https://github.com/test/repo/pull/1",
        createdAt: "2025-01-01T00:00:00Z",
        updatedAt: "2025-01-01T00:00:00Z",
      });

      await orchestrator.handlePRRevisionRequest({
        repo: "test/repo",
        prNumber: 1,
        comment: "Please fix this",
        author: "user",
      });

      // Should not try to execute revision
      expect(mockExecuteRevision).not.toHaveBeenCalled();
    });

    it("should process PRs created by haunted", async () => {
      vi.mocked(pullRequests.getPullRequest).mockResolvedValue({
        number: 1,
        title: "Haunted PR",
        body: "",
        state: "open",
        headBranch: "haunted/issue-42", // Starts with haunted/
        baseBranch: "main",
        author: "haunted",
        labels: [],
        isDraft: false,
        mergeable: "MERGEABLE",
        url: "https://github.com/test/repo/pull/1",
        createdAt: "2025-01-01T00:00:00Z",
        updatedAt: "2025-01-01T00:00:00Z",
      });

      mockExecuteRevision.mockResolvedValue({
        success: true,
        branchName: "haunted/issue-42",
        filesChanged: ["file.ts"],
        summary: "Fixed the issue",
      });

      await orchestrator.handlePRRevisionRequest({
        repo: "test/repo",
        prNumber: 1,
        comment: "Please fix this",
        author: "user",
      });

      expect(mockExecuteRevision).toHaveBeenCalled();
      expect(issues.addIssueComment).toHaveBeenCalledWith(
        "test/repo",
        1,
        expect.stringContaining("Applied revisions")
      );
    });
  });

  describe("extractSection", () => {
    // Helper to access private methods for testing
    function getPrivateMethod<T>(instance: Orchestrator, methodName: string): T {
      return (instance as unknown as Record<string, T>)[methodName] as T;
    }

    it("should extract section content between headers", () => {
      const text = `## Summary
This is the summary content.

## Changes
- Changed file A
- Changed file B

## Test Results
All tests pass.`;

      const extractSection = getPrivateMethod<(text: string, header: string, level?: number) => string | null>(
        orchestrator,
        "extractSection"
      );
      const result = extractSection.call(orchestrator, text, "## Summary");

      expect(result).toBe("This is the summary content.");
    });

    it("should extract section until end of text when no next header", () => {
      const text = `## Summary
This is the only section.
With multiple lines.`;

      const extractSection = getPrivateMethod<(text: string, header: string, level?: number) => string | null>(
        orchestrator,
        "extractSection"
      );
      const result = extractSection.call(orchestrator, text, "## Summary");

      expect(result).toBe("This is the only section.\nWith multiple lines.");
    });

    it("should return null when section not found", () => {
      const text = `## Summary
Some content`;

      const extractSection = getPrivateMethod<(text: string, header: string, level?: number) => string | null>(
        orchestrator,
        "extractSection"
      );
      const result = extractSection.call(orchestrator, text, "## Changes");

      expect(result).toBeNull();
    });

    it("should not match partial header matches", () => {
      const text = `## Summary Extended
This should not match ## Summary.

## Summary
This is the real summary.`;

      const extractSection = getPrivateMethod<(text: string, header: string, level?: number) => string | null>(
        orchestrator,
        "extractSection"
      );
      const result = extractSection.call(orchestrator, text, "## Summary");

      expect(result).toBe("This is the real summary.");
    });

    it("should handle ### subheaders within a ## section", () => {
      const text = `## Summary
Main content.

### Subsection
More details here.

## Changes
Changed files.`;

      const extractSection = getPrivateMethod<(text: string, header: string, level?: number) => string | null>(
        orchestrator,
        "extractSection"
      );
      const result = extractSection.call(orchestrator, text, "## Summary");

      expect(result).toBe("Main content.\n\n### Subsection\nMore details here.");
    });

    it("should handle empty section content", () => {
      const text = `## Summary

## Changes
Changed files.`;

      const extractSection = getPrivateMethod<(text: string, header: string, level?: number) => string | null>(
        orchestrator,
        "extractSection"
      );
      const result = extractSection.call(orchestrator, text, "## Summary");

      expect(result).toBe("");
    });
  });

  describe("formatPRDescription", () => {
    function getPrivateMethod<T>(instance: Orchestrator, methodName: string): T {
      return (instance as unknown as Record<string, T>)[methodName] as T;
    }

    it("should format PR with all sections from summary", () => {
      const summary = `## Summary
Fixed the bug in login.

## Changes
- Updated auth.ts

## Test Results
All 10 tests passing.`;

      const formatPRDescription = getPrivateMethod<(summary: string, filesChanged: string[], issueNumber: number) => string>(
        orchestrator,
        "formatPRDescription"
      );
      const result = formatPRDescription.call(orchestrator, summary, ["auth.ts"], 42);

      expect(result).toContain("## Summary");
      expect(result).toContain("Fixed the bug in login.");
      expect(result).toContain("## Changes");
      expect(result).toContain("Updated auth.ts");
      expect(result).toContain("## Test Results");
      expect(result).toContain("All 10 tests passing.");
      expect(result).toContain("Closes #42");
    });

    it("should use filesChanged when no Changes section in summary", () => {
      const summary = "Fixed the login issue by updating authentication logic.";

      const formatPRDescription = getPrivateMethod<(summary: string, filesChanged: string[], issueNumber: number) => string>(
        orchestrator,
        "formatPRDescription"
      );
      const result = formatPRDescription.call(orchestrator, summary, ["auth.ts", "login.ts"], 42);

      expect(result).toContain("**auth.ts**");
      expect(result).toContain("**login.ts**");
    });

    it("should handle empty filesChanged array", () => {
      const summary = "Quick documentation update.";

      const formatPRDescription = getPrivateMethod<(summary: string, filesChanged: string[], issueNumber: number) => string>(
        orchestrator,
        "formatPRDescription"
      );
      const result = formatPRDescription.call(orchestrator, summary, [], 42);

      expect(result).toContain("## Summary");
      expect(result).toContain("Closes #42");
    });

    it("should use entire summary when no Summary section header", () => {
      const summary = "Just a plain text summary without headers.";

      const formatPRDescription = getPrivateMethod<(summary: string, filesChanged: string[], issueNumber: number) => string>(
        orchestrator,
        "formatPRDescription"
      );
      const result = formatPRDescription.call(orchestrator, summary, [], 42);

      expect(result).toContain("Just a plain text summary without headers.");
    });
  });

  describe("getCommitPrefix", () => {
    function getPrivateMethod<T>(instance: Orchestrator, methodName: string): T {
      return (instance as unknown as Record<string, T>)[methodName] as T;
    }

    it("should return fix for bug labels", () => {
      const getCommitPrefix = getPrivateMethod<(labels: string[]) => string>(
        orchestrator,
        "getCommitPrefix"
      );

      expect(getCommitPrefix.call(orchestrator, ["bug"])).toBe("fix");
      expect(getCommitPrefix.call(orchestrator, ["Bug"])).toBe("fix");
      expect(getCommitPrefix.call(orchestrator, ["bugfix"])).toBe("fix");
      expect(getCommitPrefix.call(orchestrator, ["fix"])).toBe("fix");
    });

    it("should return feat for feature labels", () => {
      const getCommitPrefix = getPrivateMethod<(labels: string[]) => string>(
        orchestrator,
        "getCommitPrefix"
      );

      expect(getCommitPrefix.call(orchestrator, ["feature"])).toBe("feat");
      expect(getCommitPrefix.call(orchestrator, ["Feature"])).toBe("feat");
      expect(getCommitPrefix.call(orchestrator, ["enhancement"])).toBe("feat");
      expect(getCommitPrefix.call(orchestrator, ["Enhancement"])).toBe("feat");
    });

    it("should return docs for documentation labels", () => {
      const getCommitPrefix = getPrivateMethod<(labels: string[]) => string>(
        orchestrator,
        "getCommitPrefix"
      );

      expect(getCommitPrefix.call(orchestrator, ["docs"])).toBe("docs");
      expect(getCommitPrefix.call(orchestrator, ["documentation"])).toBe("docs");
    });

    it("should return refactor for refactoring labels", () => {
      const getCommitPrefix = getPrivateMethod<(labels: string[]) => string>(
        orchestrator,
        "getCommitPrefix"
      );

      expect(getCommitPrefix.call(orchestrator, ["refactor"])).toBe("refactor");
      expect(getCommitPrefix.call(orchestrator, ["refactoring"])).toBe("refactor");
    });

    it("should return test for test labels", () => {
      const getCommitPrefix = getPrivateMethod<(labels: string[]) => string>(
        orchestrator,
        "getCommitPrefix"
      );

      expect(getCommitPrefix.call(orchestrator, ["test"])).toBe("test");
      expect(getCommitPrefix.call(orchestrator, ["testing"])).toBe("test");
    });

    it("should return perf for performance labels", () => {
      const getCommitPrefix = getPrivateMethod<(labels: string[]) => string>(
        orchestrator,
        "getCommitPrefix"
      );

      expect(getCommitPrefix.call(orchestrator, ["perf"])).toBe("perf");
      expect(getCommitPrefix.call(orchestrator, ["performance"])).toBe("perf");
    });

    it("should return chore for maintenance labels", () => {
      const getCommitPrefix = getPrivateMethod<(labels: string[]) => string>(
        orchestrator,
        "getCommitPrefix"
      );

      expect(getCommitPrefix.call(orchestrator, ["chore"])).toBe("chore");
      expect(getCommitPrefix.call(orchestrator, ["maintenance"])).toBe("chore");
    });

    it("should return ci for CI/build labels", () => {
      const getCommitPrefix = getPrivateMethod<(labels: string[]) => string>(
        orchestrator,
        "getCommitPrefix"
      );

      expect(getCommitPrefix.call(orchestrator, ["ci"])).toBe("ci");
      expect(getCommitPrefix.call(orchestrator, ["build"])).toBe("ci");
    });

    it("should return style for style labels", () => {
      const getCommitPrefix = getPrivateMethod<(labels: string[]) => string>(
        orchestrator,
        "getCommitPrefix"
      );

      expect(getCommitPrefix.call(orchestrator, ["style"])).toBe("style");
    });

    it("should default to fix for unknown labels", () => {
      const getCommitPrefix = getPrivateMethod<(labels: string[]) => string>(
        orchestrator,
        "getCommitPrefix"
      );

      expect(getCommitPrefix.call(orchestrator, [])).toBe("fix");
      expect(getCommitPrefix.call(orchestrator, ["unknown"])).toBe("fix");
      expect(getCommitPrefix.call(orchestrator, ["priority:high", "area:frontend"])).toBe("fix");
    });

    it("should handle multiple labels and return first matching prefix", () => {
      const getCommitPrefix = getPrivateMethod<(labels: string[]) => string>(
        orchestrator,
        "getCommitPrefix"
      );

      // Bug takes precedence over feature
      expect(getCommitPrefix.call(orchestrator, ["feature", "bug"])).toBe("fix");
      // Feature takes precedence over docs
      expect(getCommitPrefix.call(orchestrator, ["docs", "feature"])).toBe("feat");
    });
  });
});

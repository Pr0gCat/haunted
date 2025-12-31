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
});

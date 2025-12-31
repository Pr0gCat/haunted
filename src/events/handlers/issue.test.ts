import { describe, it, expect, vi, beforeEach } from "vitest";
import { createIssueHandlers } from "./issue.ts";
import type { Config } from "@/config/schema.ts";
import type { Orchestrator } from "@/agents/orchestrator.ts";
import type { GitHubEvent } from "@/events/types.ts";
import * as projects from "@/github/projects.ts";

// Mock the projects module
vi.mock("@/github/projects.ts", () => ({
  addIssueToProject: vi.fn(),
}));

// Mock logger to avoid noise in tests
vi.mock("@/utils/logger.ts", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("issue handlers", () => {
  const mockAddIssueToProject = vi.mocked(projects.addIssueToProject);

  const mockOrchestrator = {
    processIssue: vi.fn(),
    cancelIssueProcessing: vi.fn(),
  } as unknown as Orchestrator;

  const createMockConfig = (projectConfig: Partial<Config["project"]> = {}): Config => ({
    version: "1.0",
    scope: { type: "repo", target: "owner/repo" },
    github: {
      webhook: { enabled: true, port: 3000, secret: undefined },
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
      number: 8,
      owner: "Pr0gCat",
      auto_add_issues: true,
      columns: [
        { name: "Backlog", status: "backlog" as const },
        { name: "In Progress", status: "in_progress" as const },
        { name: "Review", status: "review" as const },
        { name: "Done", status: "done" as const },
      ],
      ...projectConfig,
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
  });

  const createMockEvent = (overrides: Partial<{
    issueNumber: number;
    issueTitle: string;
    labels: string[];
    htmlUrl: string;
  }> = {}): GitHubEvent => ({
    type: "issues",
    action: "opened",
    payload: {
      action: "opened",
      issue: {
        number: overrides.issueNumber ?? 10,
        title: overrides.issueTitle ?? "Test Issue",
        body: "Test body",
        state: "open",
        user: { login: "testuser" },
        labels: (overrides.labels ?? []).map((name) => ({ name })),
        assignees: [],
        html_url: overrides.htmlUrl ?? "https://github.com/owner/repo/issues/10",
      },
      repository: {
        full_name: "owner/repo",
        default_branch: "main",
      },
      sender: { login: "testuser" },
    },
    deliveryId: "test-delivery-id",
    receivedAt: new Date(),
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("handleIssueOpened", () => {
    describe("auto-add to project", () => {
      it("should add issue to project when configured", async () => {
        const config = createMockConfig();
        const handlers = createIssueHandlers(config, mockOrchestrator);
        const event = createMockEvent();

        mockAddIssueToProject.mockResolvedValueOnce("PVTI_123");

        await handlers.handleIssueOpened(event);

        // Wait for the non-blocking project add to complete
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(mockAddIssueToProject).toHaveBeenCalledWith(
          "Pr0gCat",
          8,
          "https://github.com/owner/repo/issues/10"
        );
      });

      it("should not add issue to project when project is disabled", async () => {
        const config = createMockConfig({ enabled: false });
        const handlers = createIssueHandlers(config, mockOrchestrator);
        const event = createMockEvent();

        await handlers.handleIssueOpened(event);

        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(mockAddIssueToProject).not.toHaveBeenCalled();
      });

      it("should not add issue to project when project number is not configured", async () => {
        const config = createMockConfig({ number: undefined });
        const handlers = createIssueHandlers(config, mockOrchestrator);
        const event = createMockEvent();

        await handlers.handleIssueOpened(event);

        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(mockAddIssueToProject).not.toHaveBeenCalled();
      });

      it("should not add issue to project when project owner is not configured", async () => {
        const config = createMockConfig({ owner: undefined });
        const handlers = createIssueHandlers(config, mockOrchestrator);
        const event = createMockEvent();

        await handlers.handleIssueOpened(event);

        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(mockAddIssueToProject).not.toHaveBeenCalled();
      });

      it("should not add issue to project when auto_add_issues is disabled", async () => {
        const config = createMockConfig({ auto_add_issues: false });
        const handlers = createIssueHandlers(config, mockOrchestrator);
        const event = createMockEvent();

        await handlers.handleIssueOpened(event);

        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(mockAddIssueToProject).not.toHaveBeenCalled();
      });

      it("should continue processing even if adding to project fails", async () => {
        const config = createMockConfig();
        const handlers = createIssueHandlers(config, mockOrchestrator);
        const event = createMockEvent();

        mockAddIssueToProject.mockRejectedValueOnce(new Error("API error"));

        await handlers.handleIssueOpened(event);

        // Wait for the non-blocking project add to fail silently
        await new Promise((resolve) => setTimeout(resolve, 10));

        // Should still process the issue normally
        expect(mockOrchestrator.processIssue).toHaveBeenCalled();
      });
    });

    describe("label checks", () => {
      it("should skip processing when human-only label is present", async () => {
        const config = createMockConfig();
        const handlers = createIssueHandlers(config, mockOrchestrator);
        const event = createMockEvent({ labels: ["human-only"] });

        await handlers.handleIssueOpened(event);

        expect(mockOrchestrator.processIssue).not.toHaveBeenCalled();
      });

      it("should skip processing when skip label is present", async () => {
        const config = createMockConfig();
        const handlers = createIssueHandlers(config, mockOrchestrator);
        const event = createMockEvent({ labels: ["haunted-skip"] });

        await handlers.handleIssueOpened(event);

        expect(mockOrchestrator.processIssue).not.toHaveBeenCalled();
      });

      it("should still add to project even with skip labels", async () => {
        const config = createMockConfig();
        const handlers = createIssueHandlers(config, mockOrchestrator);
        const event = createMockEvent({ labels: ["human-only"] });

        mockAddIssueToProject.mockResolvedValueOnce("PVTI_123");

        await handlers.handleIssueOpened(event);

        await new Promise((resolve) => setTimeout(resolve, 10));

        // Project add should still happen
        expect(mockAddIssueToProject).toHaveBeenCalled();
        // But orchestrator processing should be skipped
        expect(mockOrchestrator.processIssue).not.toHaveBeenCalled();
      });
    });

    describe("orchestrator processing", () => {
      it("should call orchestrator.processIssue with correct data", async () => {
        const config = createMockConfig();
        const handlers = createIssueHandlers(config, mockOrchestrator);
        const event = createMockEvent({
          issueNumber: 42,
          issueTitle: "Fix the bug",
          labels: ["bug", "urgent"],
        });

        await handlers.handleIssueOpened(event);

        expect(mockOrchestrator.processIssue).toHaveBeenCalledWith({
          repo: "owner/repo",
          number: 42,
          title: "Fix the bug",
          body: "Test body",
          labels: ["bug", "urgent"],
          author: "testuser",
        });
      });
    });
  });

  describe("handleIssueClosed", () => {
    it("should cancel issue processing", async () => {
      const config = createMockConfig();
      const handlers = createIssueHandlers(config, mockOrchestrator);

      const event: GitHubEvent = {
        type: "issues",
        action: "closed",
        payload: {
          action: "closed",
          issue: {
            number: 10,
            title: "Test Issue",
            body: "Test body",
            state: "closed",
            user: { login: "testuser" },
            labels: [],
            assignees: [],
            html_url: "https://github.com/owner/repo/issues/10",
          },
          repository: {
            full_name: "owner/repo",
            default_branch: "main",
          },
          sender: { login: "testuser" },
        },
        deliveryId: "test-delivery-id",
        receivedAt: new Date(),
      };

      await handlers.handleIssueClosed(event);

      expect(mockOrchestrator.cancelIssueProcessing).toHaveBeenCalledWith(
        "owner/repo",
        10
      );
    });
  });

  describe("handleIssueLabeled", () => {
    it("should cancel processing when human-only label is added", async () => {
      const config = createMockConfig();
      const handlers = createIssueHandlers(config, mockOrchestrator);

      const event: GitHubEvent = {
        type: "issues",
        action: "labeled",
        payload: {
          action: "labeled",
          issue: {
            number: 10,
            title: "Test Issue",
            body: "Test body",
            state: "open",
            user: { login: "testuser" },
            labels: [{ name: "human-only" }],
            assignees: [],
            html_url: "https://github.com/owner/repo/issues/10",
          },
          repository: {
            full_name: "owner/repo",
            default_branch: "main",
          },
          sender: { login: "testuser" },
        },
        deliveryId: "test-delivery-id",
        receivedAt: new Date(),
      };

      await handlers.handleIssueLabeled(event);

      expect(mockOrchestrator.cancelIssueProcessing).toHaveBeenCalledWith(
        "owner/repo",
        10
      );
    });

    it("should not cancel processing for other labels", async () => {
      const config = createMockConfig();
      const handlers = createIssueHandlers(config, mockOrchestrator);

      const event: GitHubEvent = {
        type: "issues",
        action: "labeled",
        payload: {
          action: "labeled",
          issue: {
            number: 10,
            title: "Test Issue",
            body: "Test body",
            state: "open",
            user: { login: "testuser" },
            labels: [{ name: "bug" }],
            assignees: [],
            html_url: "https://github.com/owner/repo/issues/10",
          },
          repository: {
            full_name: "owner/repo",
            default_branch: "main",
          },
          sender: { login: "testuser" },
        },
        deliveryId: "test-delivery-id",
        receivedAt: new Date(),
      };

      await handlers.handleIssueLabeled(event);

      expect(mockOrchestrator.cancelIssueProcessing).not.toHaveBeenCalled();
    });
  });
});

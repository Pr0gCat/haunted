import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listPullRequests,
  getPullRequest,
  createPullRequest,
  addPRReview,
  getPRDiff,
} from "./pull-requests.ts";
import * as ghCli from "./cli.ts";

vi.mock("./cli.ts", () => ({
  gh: vi.fn(),
}));

vi.mock("@/utils/logger.ts", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("github/pull-requests", () => {
  const mockGh = vi.mocked(ghCli.gh);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("listPullRequests", () => {
    it("should list PRs with correct arguments", async () => {
      const mockPRs = [
        {
          number: 1,
          title: "Test PR",
          body: "PR body",
          state: "open",
          headRefName: "feature-branch",
          baseRefName: "main",
          author: { login: "dev" },
          labels: [{ name: "enhancement" }],
          isDraft: false,
          mergeable: "MERGEABLE",
          url: "https://github.com/test/repo/pull/1",
          createdAt: "2025-01-01T00:00:00Z",
          updatedAt: "2025-01-01T00:00:00Z",
        },
      ];

      mockGh.mockResolvedValueOnce({
        stdout: JSON.stringify(mockPRs),
        stderr: "",
        exitCode: 0,
      });

      const result = await listPullRequests("test/repo");

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        number: 1,
        title: "Test PR",
        body: "PR body",
        state: "open",
        headBranch: "feature-branch",
        baseBranch: "main",
        author: "dev",
        labels: ["enhancement"],
        isDraft: false,
        mergeable: "MERGEABLE",
        url: "https://github.com/test/repo/pull/1",
        createdAt: "2025-01-01T00:00:00Z",
        updatedAt: "2025-01-01T00:00:00Z",
      });
    });

    it("should filter by state", async () => {
      mockGh.mockResolvedValueOnce({
        stdout: "[]",
        stderr: "",
        exitCode: 0,
      });

      await listPullRequests("test/repo", { state: "closed" });

      expect(mockGh).toHaveBeenCalledWith(
        expect.arrayContaining(["--state", "closed"])
      );
    });

    it("should throw on error", async () => {
      mockGh.mockResolvedValueOnce({
        stdout: "",
        stderr: "Not found",
        exitCode: 1,
      });

      await expect(listPullRequests("test/repo")).rejects.toThrow(
        "Failed to list PRs"
      );
    });
  });

  describe("getPullRequest", () => {
    it("should get a single PR", async () => {
      const mockPR = {
        number: 42,
        title: "Feature PR",
        body: "Description",
        state: "open",
        headRefName: "feature",
        baseRefName: "main",
        author: { login: "developer" },
        labels: [],
        isDraft: true,
        mergeable: "UNKNOWN",
        url: "https://github.com/test/repo/pull/42",
        createdAt: "2025-01-01T00:00:00Z",
        updatedAt: "2025-01-02T00:00:00Z",
      };

      mockGh.mockResolvedValueOnce({
        stdout: JSON.stringify(mockPR),
        stderr: "",
        exitCode: 0,
      });

      const result = await getPullRequest("test/repo", 42);

      expect(result.number).toBe(42);
      expect(result.headBranch).toBe("feature");
      expect(result.isDraft).toBe(true);
    });

    it("should throw on PR not found", async () => {
      mockGh.mockResolvedValueOnce({
        stdout: "",
        stderr: "not found",
        exitCode: 1,
      });

      await expect(getPullRequest("test/repo", 999)).rejects.toThrow(
        "Failed to get PR #999"
      );
    });
  });

  describe("createPullRequest", () => {
    it("should create a PR with required fields", async () => {
      mockGh
        .mockResolvedValueOnce({
          stdout: "https://github.com/test/repo/pull/10\n",
          stderr: "",
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          stdout: JSON.stringify({
            number: 10,
            title: "New Feature",
            body: "Description",
            state: "open",
            headRefName: "feature-branch",
            baseRefName: "main",
            author: { login: "creator" },
            labels: [],
            isDraft: false,
            mergeable: "UNKNOWN",
            url: "https://github.com/test/repo/pull/10",
            createdAt: "2025-01-01T00:00:00Z",
            updatedAt: "2025-01-01T00:00:00Z",
          }),
          stderr: "",
          exitCode: 0,
        });

      const result = await createPullRequest({
        repo: "test/repo",
        title: "New Feature",
        head: "feature-branch",
      });

      expect(result.number).toBe(10);
      expect(mockGh).toHaveBeenCalledWith(
        expect.arrayContaining([
          "pr",
          "create",
          "-R",
          "test/repo",
          "--title",
          "New Feature",
          "--head",
          "feature-branch",
          "--base",
          "main",
        ])
      );
    });

    it("should include optional fields", async () => {
      mockGh
        .mockResolvedValueOnce({
          stdout: "https://github.com/test/repo/pull/1",
          stderr: "",
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          stdout: JSON.stringify({
            number: 1,
            title: "Test",
            body: "Body",
            state: "open",
            headRefName: "branch",
            baseRefName: "develop",
            author: { login: "user" },
            labels: [{ name: "feature" }],
            isDraft: true,
            mergeable: "UNKNOWN",
            url: "https://github.com/test/repo/pull/1",
            createdAt: "2025-01-01T00:00:00Z",
            updatedAt: "2025-01-01T00:00:00Z",
          }),
          stderr: "",
          exitCode: 0,
        });

      await createPullRequest({
        repo: "test/repo",
        title: "Test",
        head: "branch",
        base: "develop",
        body: "Body",
        draft: true,
        labels: ["feature"],
      });

      expect(mockGh).toHaveBeenCalledWith(
        expect.arrayContaining([
          "--base",
          "develop",
          "--body",
          "Body",
          "--draft",
          "--label",
          "feature",
        ])
      );
    });

    it("should throw if URL parsing fails", async () => {
      mockGh.mockResolvedValueOnce({
        stdout: "Invalid output",
        stderr: "",
        exitCode: 0,
      });

      await expect(
        createPullRequest({ repo: "test/repo", title: "Test", head: "branch" })
      ).rejects.toThrow("Failed to parse PR URL");
    });
  });

  describe("addPRReview", () => {
    it("should approve a PR", async () => {
      mockGh.mockResolvedValueOnce({
        stdout: "",
        stderr: "",
        exitCode: 0,
      });

      await addPRReview({
        repo: "test/repo",
        number: 1,
        event: "APPROVE",
        body: "LGTM!",
      });

      expect(mockGh).toHaveBeenCalledWith([
        "pr",
        "review",
        "1",
        "-R",
        "test/repo",
        "--approve",
        "--body",
        "LGTM!",
      ]);
    });

    it("should request changes", async () => {
      mockGh.mockResolvedValueOnce({
        stdout: "",
        stderr: "",
        exitCode: 0,
      });

      await addPRReview({
        repo: "test/repo",
        number: 1,
        event: "REQUEST_CHANGES",
        body: "Please fix",
      });

      expect(mockGh).toHaveBeenCalledWith(
        expect.arrayContaining(["--request-changes"])
      );
    });

    it("should handle self-approval restriction gracefully", async () => {
      // First call fails with self-approval error
      mockGh
        .mockResolvedValueOnce({
          stdout: "",
          stderr: "Can not approve your own pull request",
          exitCode: 1,
        })
        // Second call is to add a comment instead
        .mockResolvedValueOnce({
          stdout: "",
          stderr: "",
          exitCode: 0,
        });

      // Should not throw
      await addPRReview({
        repo: "test/repo",
        number: 1,
        event: "APPROVE",
        body: "LGTM!",
      });

      // Should have called addPRComment
      expect(mockGh).toHaveBeenCalledTimes(2);
      expect(mockGh).toHaveBeenLastCalledWith(
        expect.arrayContaining(["pr", "comment", "1"])
      );
    });

    it("should throw on other errors", async () => {
      mockGh.mockResolvedValueOnce({
        stdout: "",
        stderr: "permission denied",
        exitCode: 1,
      });

      await expect(
        addPRReview({
          repo: "test/repo",
          number: 1,
          event: "APPROVE",
        })
      ).rejects.toThrow("Failed to add review");
    });
  });

  describe("getPRDiff", () => {
    it("should get PR diff", async () => {
      const mockDiff = `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1 +1 @@
-old
+new`;

      mockGh.mockResolvedValueOnce({
        stdout: mockDiff,
        stderr: "",
        exitCode: 0,
      });

      const result = await getPRDiff("test/repo", 1);

      expect(result).toBe(mockDiff);
      expect(mockGh).toHaveBeenCalledWith([
        "pr",
        "diff",
        "1",
        "-R",
        "test/repo",
      ]);
    });

    it("should throw on error", async () => {
      mockGh.mockResolvedValueOnce({
        stdout: "",
        stderr: "not found",
        exitCode: 1,
      });

      await expect(getPRDiff("test/repo", 999)).rejects.toThrow(
        "Failed to get PR diff"
      );
    });
  });
});

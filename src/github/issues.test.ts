import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  listIssues,
  getIssue,
  getIssueComments,
  addIssueComment,
  addIssueLabels,
  createIssue,
} from "./issues.ts";
import * as ghCli from "./cli.ts";

// Mock the gh CLI module
vi.mock("./cli.ts", () => ({
  gh: vi.fn(),
  ghJson: vi.fn(),
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

describe("github/issues", () => {
  const mockGh = vi.mocked(ghCli.gh);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("listIssues", () => {
    it("should list issues with correct arguments", async () => {
      const mockIssues = [
        {
          number: 1,
          title: "Test Issue",
          body: "Test body",
          state: "open",
          labels: [{ name: "bug" }],
          assignees: [{ login: "user1" }],
          author: { login: "author1" },
          createdAt: "2025-01-01T00:00:00Z",
          updatedAt: "2025-01-01T00:00:00Z",
          url: "https://github.com/test/repo/issues/1",
        },
      ];

      mockGh.mockResolvedValueOnce({
        stdout: JSON.stringify(mockIssues),
        stderr: "",
        exitCode: 0,
      });

      const result = await listIssues("test/repo");

      expect(mockGh).toHaveBeenCalledWith([
        "issue",
        "list",
        "-R",
        "test/repo",
        "--json",
        "number,title,body,state,labels,assignees,author,createdAt,updatedAt,url",
      ]);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        number: 1,
        title: "Test Issue",
        body: "Test body",
        state: "open",
        labels: ["bug"],
        assignees: ["user1"],
        author: "author1",
        createdAt: "2025-01-01T00:00:00Z",
        updatedAt: "2025-01-01T00:00:00Z",
        url: "https://github.com/test/repo/issues/1",
      });
    });

    it("should filter by state", async () => {
      mockGh.mockResolvedValueOnce({
        stdout: "[]",
        stderr: "",
        exitCode: 0,
      });

      await listIssues("test/repo", { state: "closed" });

      expect(mockGh).toHaveBeenCalledWith(
        expect.arrayContaining(["--state", "closed"])
      );
    });

    it("should filter by labels", async () => {
      mockGh.mockResolvedValueOnce({
        stdout: "[]",
        stderr: "",
        exitCode: 0,
      });

      await listIssues("test/repo", { labels: ["bug", "urgent"] });

      expect(mockGh).toHaveBeenCalledWith(
        expect.arrayContaining(["--label", "bug,urgent"])
      );
    });

    it("should throw on gh error", async () => {
      mockGh.mockResolvedValueOnce({
        stdout: "",
        stderr: "Not found",
        exitCode: 1,
      });

      await expect(listIssues("test/repo")).rejects.toThrow("Failed to list issues");
    });

    it("should handle empty issue list", async () => {
      mockGh.mockResolvedValueOnce({
        stdout: "[]",
        stderr: "",
        exitCode: 0,
      });

      const result = await listIssues("test/repo");
      expect(result).toEqual([]);
    });

    it("should correctly map labels array", async () => {
      const mockIssues = [
        {
          number: 1,
          title: "Multi-label issue",
          body: "",
          state: "open",
          labels: [{ name: "bug" }, { name: "urgent" }, { name: "help wanted" }],
          assignees: [],
          author: { login: "test" },
          createdAt: "2025-01-01T00:00:00Z",
          updatedAt: "2025-01-01T00:00:00Z",
          url: "https://github.com/test/repo/issues/1",
        },
      ];

      mockGh.mockResolvedValueOnce({
        stdout: JSON.stringify(mockIssues),
        stderr: "",
        exitCode: 0,
      });

      const result = await listIssues("test/repo");
      expect(result[0]?.labels).toEqual(["bug", "urgent", "help wanted"]);
    });
  });

  describe("getIssue", () => {
    it("should get a single issue", async () => {
      const mockIssue = {
        number: 42,
        title: "Bug fix",
        body: "Fix the bug",
        state: "open",
        labels: [{ name: "bug" }],
        assignees: [],
        author: { login: "developer" },
        createdAt: "2025-01-01T00:00:00Z",
        updatedAt: "2025-01-02T00:00:00Z",
        url: "https://github.com/test/repo/issues/42",
      };

      mockGh.mockResolvedValueOnce({
        stdout: JSON.stringify(mockIssue),
        stderr: "",
        exitCode: 0,
      });

      const result = await getIssue("test/repo", 42);

      expect(mockGh).toHaveBeenCalledWith([
        "issue",
        "view",
        "42",
        "-R",
        "test/repo",
        "--json",
        "number,title,body,state,labels,assignees,author,createdAt,updatedAt,url",
      ]);

      expect(result.number).toBe(42);
      expect(result.title).toBe("Bug fix");
      expect(result.author).toBe("developer");
    });

    it("should throw on issue not found", async () => {
      mockGh.mockResolvedValueOnce({
        stdout: "",
        stderr: "issue not found",
        exitCode: 1,
      });

      await expect(getIssue("test/repo", 999)).rejects.toThrow(
        "Failed to get issue #999"
      );
    });
  });

  describe("getIssueComments", () => {
    it("should get issue comments", async () => {
      const mockData = {
        comments: [
          {
            id: "123",
            body: "This is a comment",
            author: { login: "commenter" },
            createdAt: "2025-01-01T12:00:00Z",
          },
          {
            id: "456",
            body: "Another comment",
            author: { login: "another" },
            createdAt: "2025-01-01T13:00:00Z",
          },
        ],
      };

      mockGh.mockResolvedValueOnce({
        stdout: JSON.stringify(mockData),
        stderr: "",
        exitCode: 0,
      });

      const result = await getIssueComments("test/repo", 1);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 123,
        body: "This is a comment",
        author: "commenter",
        createdAt: "2025-01-01T12:00:00Z",
      });
    });

    it("should return empty array on error", async () => {
      mockGh.mockResolvedValueOnce({
        stdout: "",
        stderr: "error",
        exitCode: 1,
      });

      const result = await getIssueComments("test/repo", 1);
      expect(result).toEqual([]);
    });

    it("should handle non-numeric comment IDs", async () => {
      const mockData = {
        comments: [
          {
            id: "not-a-number",
            body: "Comment",
            author: { login: "user" },
            createdAt: "2025-01-01T00:00:00Z",
          },
        ],
      };

      mockGh.mockResolvedValueOnce({
        stdout: JSON.stringify(mockData),
        stderr: "",
        exitCode: 0,
      });

      const result = await getIssueComments("test/repo", 1);
      expect(result[0]?.id).toBe(0); // Falls back to 0 for invalid ID
    });
  });

  describe("addIssueComment", () => {
    it("should add a comment to issue", async () => {
      mockGh.mockResolvedValueOnce({
        stdout: "",
        stderr: "",
        exitCode: 0,
      });

      await addIssueComment("test/repo", 1, "Test comment");

      expect(mockGh).toHaveBeenCalledWith([
        "issue",
        "comment",
        "1",
        "-R",
        "test/repo",
        "--body",
        "Test comment",
      ]);
    });

    it("should throw on error", async () => {
      mockGh.mockResolvedValueOnce({
        stdout: "",
        stderr: "permission denied",
        exitCode: 1,
      });

      await expect(
        addIssueComment("test/repo", 1, "Test comment")
      ).rejects.toThrow("Failed to add comment");
    });
  });

  describe("addIssueLabels", () => {
    it("should add labels to issue", async () => {
      mockGh.mockResolvedValueOnce({
        stdout: "",
        stderr: "",
        exitCode: 0,
      });

      await addIssueLabels("test/repo", 1, ["bug", "urgent"]);

      expect(mockGh).toHaveBeenCalledWith([
        "issue",
        "edit",
        "1",
        "-R",
        "test/repo",
        "--add-label",
        "bug,urgent",
      ]);
    });

    it("should throw on error", async () => {
      mockGh.mockResolvedValueOnce({
        stdout: "",
        stderr: "label not found",
        exitCode: 1,
      });

      await expect(addIssueLabels("test/repo", 1, ["invalid"])).rejects.toThrow(
        "Failed to add labels"
      );
    });
  });

  describe("createIssue", () => {
    it("should create an issue and return it", async () => {
      // First call creates issue, second call gets the created issue
      mockGh
        .mockResolvedValueOnce({
          stdout: "https://github.com/test/repo/issues/42",
          stderr: "",
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          stdout: JSON.stringify({
            number: 42,
            title: "New Issue",
            body: "Description",
            state: "open",
            labels: [],
            assignees: [],
            author: { login: "creator" },
            createdAt: "2025-01-01T00:00:00Z",
            updatedAt: "2025-01-01T00:00:00Z",
            url: "https://github.com/test/repo/issues/42",
          }),
          stderr: "",
          exitCode: 0,
        });

      const result = await createIssue({
        repo: "test/repo",
        title: "New Issue",
        body: "Description",
      });

      expect(result.number).toBe(42);
      expect(result.title).toBe("New Issue");
    });

    it("should include labels and assignees when provided", async () => {
      mockGh
        .mockResolvedValueOnce({
          stdout: "https://github.com/test/repo/issues/1",
          stderr: "",
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          stdout: JSON.stringify({
            number: 1,
            title: "Test",
            body: "",
            state: "open",
            labels: [{ name: "bug" }],
            assignees: [{ login: "user1" }],
            author: { login: "creator" },
            createdAt: "2025-01-01T00:00:00Z",
            updatedAt: "2025-01-01T00:00:00Z",
            url: "https://github.com/test/repo/issues/1",
          }),
          stderr: "",
          exitCode: 0,
        });

      await createIssue({
        repo: "test/repo",
        title: "Test",
        labels: ["bug"],
        assignees: ["user1"],
      });

      expect(mockGh).toHaveBeenCalledWith(
        expect.arrayContaining(["--label", "bug", "--assignee", "user1"])
      );
    });

    it("should throw if URL parsing fails", async () => {
      mockGh.mockResolvedValueOnce({
        stdout: "Invalid output",
        stderr: "",
        exitCode: 0,
      });

      await expect(
        createIssue({ repo: "test/repo", title: "Test" })
      ).rejects.toThrow("Failed to parse issue URL");
    });

    it("should throw on creation error", async () => {
      mockGh.mockResolvedValueOnce({
        stdout: "",
        stderr: "permission denied",
        exitCode: 1,
      });

      await expect(
        createIssue({ repo: "test/repo", title: "Test" })
      ).rejects.toThrow("Failed to create issue");
    });
  });
});

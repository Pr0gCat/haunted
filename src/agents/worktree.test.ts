import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WorktreeManager } from "./worktree.ts";
import { spawn } from "node:child_process";
import { mkdir, rm, access } from "node:fs/promises";
import { EventEmitter } from "node:events";

// Mock child_process
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

// Mock fs/promises
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(),
  rm: vi.fn(),
  access: vi.fn(),
}));

// Mock logger
vi.mock("@/utils/logger.ts", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("WorktreeManager", () => {
  const mockSpawn = vi.mocked(spawn);
  const mockMkdir = vi.mocked(mkdir);
  const mockRm = vi.mocked(rm);
  const mockAccess = vi.mocked(access);

  function createMockProcess(stdout = "", stderr = "", exitCode = 0) {
    const proc = new EventEmitter() as ReturnType<typeof spawn>;
    const stdoutEmitter = new EventEmitter();
    const stderrEmitter = new EventEmitter();

    (proc as any).stdout = stdoutEmitter;
    (proc as any).stderr = stderrEmitter;

    // Emit data and close in next tick
    setTimeout(() => {
      if (stdout) stdoutEmitter.emit("data", Buffer.from(stdout));
      if (stderr) stderrEmitter.emit("data", Buffer.from(stderr));
      proc.emit("close", exitCode);
    }, 0);

    return proc;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockRm.mockResolvedValue(undefined);
  });

  describe("init", () => {
    it("should create base directory", async () => {
      const manager = new WorktreeManager("/tmp/test-worktrees");
      await manager.init();

      expect(mockMkdir).toHaveBeenCalledWith("/tmp/test-worktrees", {
        recursive: true,
      });
    });
  });

  describe("createWorktree", () => {
    it("should create a new worktree", async () => {
      const manager = new WorktreeManager("/tmp/test-worktrees");

      // Path doesn't exist
      mockAccess.mockRejectedValueOnce(new Error("ENOENT"));

      // git fetch
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0));
      // git show-ref (branch doesn't exist)
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 1));
      // git branch (create branch)
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0));
      // git worktree list
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0));
      // git worktree add
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0));

      const worktree = await manager.createWorktree(
        "test/repo",
        "/path/to/repo",
        42,
        "haunted/issue-42"
      );

      expect(worktree.branch).toBe("haunted/issue-42");
      expect(worktree.issueNumber).toBe(42);
      expect(worktree.repo).toBe("test/repo");
      expect(worktree.path).toBe("/tmp/test-worktrees/test-repo-issue-42");
    });

    it("should return existing worktree if already exists", async () => {
      const manager = new WorktreeManager("/tmp/test-worktrees");

      // First creation
      mockAccess.mockRejectedValueOnce(new Error("ENOENT"));
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0)); // fetch
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 1)); // show-ref
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0)); // branch
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0)); // worktree list
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0)); // worktree add

      const first = await manager.createWorktree(
        "test/repo",
        "/path/to/repo",
        1,
        "branch-1"
      );

      // Second call should return same worktree without calling git
      const second = await manager.createWorktree(
        "test/repo",
        "/path/to/repo",
        1,
        "branch-1"
      );

      expect(first).toBe(second);
    });

    it("should handle existing branch", async () => {
      const manager = new WorktreeManager("/tmp/test-worktrees");

      mockAccess.mockRejectedValueOnce(new Error("ENOENT"));
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0)); // fetch
      // Branch exists
      mockSpawn.mockReturnValueOnce(
        createMockProcess("refs/heads/existing-branch", "", 0)
      );
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0)); // worktree list
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0)); // worktree add

      const worktree = await manager.createWorktree(
        "test/repo",
        "/path/to/repo",
        1,
        "existing-branch"
      );

      expect(worktree.branch).toBe("existing-branch");
    });

    it("should clean up existing worktree path before creating", async () => {
      const manager = new WorktreeManager("/tmp/test-worktrees");

      // Path exists
      mockAccess.mockResolvedValueOnce(undefined);
      // Remove worktree
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0));
      // git fetch
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0));
      // git show-ref
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 1));
      // git branch
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0));
      // git worktree list
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0));
      // git worktree add
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0));

      await manager.createWorktree(
        "test/repo",
        "/path/to/repo",
        1,
        "branch"
      );

      // Should have called worktree remove
      expect(mockSpawn).toHaveBeenCalledWith(
        "git",
        expect.arrayContaining(["worktree", "remove"]),
        expect.anything()
      );
    });
  });

  describe("createWorktreeForRevision", () => {
    it("should create worktree for existing PR branch", async () => {
      const manager = new WorktreeManager("/tmp/test-worktrees");

      mockAccess.mockRejectedValueOnce(new Error("ENOENT"));
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0)); // fetch
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0)); // worktree prune
      // Branch exists locally
      mockSpawn.mockReturnValueOnce(
        createMockProcess("refs/heads/haunted/issue-1", "", 0)
      );
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0)); // worktree add
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0)); // git pull

      const worktree = await manager.createWorktreeForRevision(
        "test/repo",
        "/path/to/repo",
        1,
        "haunted/issue-1"
      );

      expect(worktree.branch).toBe("haunted/issue-1");
      expect(worktree.path).toBe("/tmp/test-worktrees/test-repo-pr-1");
    });

    it("should checkout from remote if local branch doesn't exist", async () => {
      const manager = new WorktreeManager("/tmp/test-worktrees");

      mockAccess.mockRejectedValueOnce(new Error("ENOENT"));
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0)); // fetch
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0)); // worktree prune
      // Branch doesn't exist locally
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 1));
      // worktree add from remote
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0));
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0)); // git pull

      await manager.createWorktreeForRevision(
        "test/repo",
        "/path/to/repo",
        1,
        "remote-branch"
      );

      // Should have called worktree add with -b and origin/
      expect(mockSpawn).toHaveBeenCalledWith(
        "git",
        expect.arrayContaining(["-b", "remote-branch", expect.stringContaining("origin/remote-branch")]),
        expect.anything()
      );
    });
  });

  describe("removeWorktree", () => {
    it("should remove worktree", async () => {
      const manager = new WorktreeManager("/tmp/test-worktrees");

      // Create a worktree first
      mockAccess.mockRejectedValueOnce(new Error("ENOENT"));
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0));
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 1));
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0));
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0));
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0));

      await manager.createWorktree("test/repo", "/path", 1, "branch");

      // Remove it
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0));
      await manager.removeWorktree("test/repo", 1);

      expect(manager.getWorktree("test/repo", 1)).toBeUndefined();
    });

    it("should do nothing if worktree doesn't exist", async () => {
      const manager = new WorktreeManager("/tmp/test-worktrees");

      await manager.removeWorktree("test/repo", 999);

      // No git commands should be called
      expect(mockSpawn).not.toHaveBeenCalled();
    });
  });

  describe("getActiveCount", () => {
    it("should return correct count", async () => {
      const manager = new WorktreeManager("/tmp/test-worktrees");

      expect(manager.getActiveCount()).toBe(0);

      // Create first worktree
      mockAccess.mockRejectedValueOnce(new Error("ENOENT"));
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0)); // fetch
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 1)); // show-ref
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0)); // branch
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0)); // worktree list
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0)); // worktree add

      await manager.createWorktree("test/repo", "/path", 1, "branch-1");
      expect(manager.getActiveCount()).toBe(1);

      // Create second worktree
      mockAccess.mockRejectedValueOnce(new Error("ENOENT"));
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0)); // fetch
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 1)); // show-ref
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0)); // branch
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0)); // worktree list
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0)); // worktree add

      await manager.createWorktree("test/repo", "/path", 2, "branch-2");
      expect(manager.getActiveCount()).toBe(2);
    });
  });

  describe("listWorktrees", () => {
    it("should list all worktrees", async () => {
      const manager = new WorktreeManager("/tmp/test-worktrees");

      // Create first worktree
      mockAccess.mockRejectedValueOnce(new Error("ENOENT"));
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0));
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 1));
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0));
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0));
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0));

      await manager.createWorktree("test/repo", "/path", 1, "branch-1");

      // Create second worktree
      mockAccess.mockRejectedValueOnce(new Error("ENOENT"));
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0));
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 1));
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0));
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0));
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0));

      await manager.createWorktree("test/repo", "/path", 2, "branch-2");

      const worktrees = manager.listWorktrees();

      expect(worktrees).toHaveLength(2);
      expect(worktrees.map((w) => w.issueNumber).sort()).toEqual([1, 2]);
    });
  });

  describe("cleanup", () => {
    it("should remove all worktrees", async () => {
      const manager = new WorktreeManager("/tmp/test-worktrees");

      // Create first worktree
      mockAccess.mockRejectedValueOnce(new Error("ENOENT"));
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0));
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 1));
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0));
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0));
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0));

      await manager.createWorktree("test/repo", "/path", 1, "branch-1");

      // Create second worktree
      mockAccess.mockRejectedValueOnce(new Error("ENOENT"));
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0));
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 1));
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0));
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0));
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0));

      await manager.createWorktree("test/repo", "/path", 2, "branch-2");

      expect(manager.getActiveCount()).toBe(2);

      // Cleanup - mock remove for each worktree
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0));
      mockSpawn.mockReturnValueOnce(createMockProcess("", "", 0));

      await manager.cleanup();

      expect(manager.getActiveCount()).toBe(0);
    });
  });
});

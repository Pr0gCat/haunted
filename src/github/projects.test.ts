import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listProjects,
  getProject,
  getProjectItems,
  addIssueToProject,
  getProjectFields,
  moveItemToColumn,
} from "./projects.ts";
import * as ghCli from "./cli.ts";

// Mock the gh CLI module
vi.mock("./cli.ts", () => ({
  gh: vi.fn(),
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

describe("github/projects", () => {
  const mockGh = vi.mocked(ghCli.gh);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("listProjects", () => {
    it("should list user projects", async () => {
      const mockProjects = {
        data: {
          user: {
            projectsV2: {
              nodes: [
                {
                  id: "PVT_1",
                  title: "Haunted Project",
                  number: 8,
                  url: "https://github.com/users/Pr0gCat/projects/8",
                },
              ],
            },
          },
        },
      };

      mockGh.mockResolvedValueOnce({
        stdout: JSON.stringify(mockProjects),
        stderr: "",
        exitCode: 0,
      });

      const result = await listProjects("Pr0gCat");

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: "PVT_1",
        title: "Haunted Project",
        number: 8,
        url: "https://github.com/users/Pr0gCat/projects/8",
      });
    });

    it("should fall back to organization projects if user query fails", async () => {
      const mockOrgProjects = {
        data: {
          organization: {
            projectsV2: {
              nodes: [
                {
                  id: "PVT_ORG_1",
                  title: "Org Project",
                  number: 1,
                  url: "https://github.com/orgs/myorg/projects/1",
                },
              ],
            },
          },
        },
      };

      mockGh
        .mockResolvedValueOnce({
          stdout: "",
          stderr: "User not found",
          exitCode: 1,
        })
        .mockResolvedValueOnce({
          stdout: JSON.stringify(mockOrgProjects),
          stderr: "",
          exitCode: 0,
        });

      const result = await listProjects("myorg");

      expect(mockGh).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(1);
      expect(result[0]?.title).toBe("Org Project");
    });

    it("should throw if both user and org queries fail", async () => {
      mockGh
        .mockResolvedValueOnce({
          stdout: "",
          stderr: "User not found",
          exitCode: 1,
        })
        .mockResolvedValueOnce({
          stdout: "",
          stderr: "Organization not found",
          exitCode: 1,
        });

      await expect(listProjects("nonexistent")).rejects.toThrow(
        "Failed to list projects"
      );
    });
  });

  describe("getProject", () => {
    it("should return project by number", async () => {
      const mockProjects = {
        data: {
          user: {
            projectsV2: {
              nodes: [
                { id: "PVT_1", title: "Project 1", number: 1, url: "url1" },
                { id: "PVT_2", title: "Project 2", number: 8, url: "url2" },
              ],
            },
          },
        },
      };

      mockGh.mockResolvedValueOnce({
        stdout: JSON.stringify(mockProjects),
        stderr: "",
        exitCode: 0,
      });

      const result = await getProject("Pr0gCat", 8);

      expect(result).toEqual({
        id: "PVT_2",
        title: "Project 2",
        number: 8,
        url: "url2",
      });
    });

    it("should return null if project not found", async () => {
      const mockProjects = {
        data: {
          user: {
            projectsV2: {
              nodes: [
                { id: "PVT_1", title: "Project 1", number: 1, url: "url1" },
              ],
            },
          },
        },
      };

      mockGh.mockResolvedValueOnce({
        stdout: JSON.stringify(mockProjects),
        stderr: "",
        exitCode: 0,
      });

      const result = await getProject("Pr0gCat", 999);
      expect(result).toBeNull();
    });
  });

  describe("getProjectItems", () => {
    it("should list project items", async () => {
      const mockItems = {
        items: [
          {
            id: "ITEM_1",
            title: "Issue Title",
            status: "In Progress",
            type: "ISSUE",
            content: { number: 10, repository: "owner/repo" },
          },
        ],
      };

      mockGh.mockResolvedValueOnce({
        stdout: JSON.stringify(mockItems),
        stderr: "",
        exitCode: 0,
      });

      const result = await getProjectItems("Pr0gCat", 8);

      expect(mockGh).toHaveBeenCalledWith([
        "project",
        "item-list",
        "8",
        "--owner",
        "Pr0gCat",
        "--format",
        "json",
      ]);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: "ITEM_1",
        title: "Issue Title",
        status: "In Progress",
        type: "ISSUE",
        content: { number: 10, repository: "owner/repo" },
      });
    });

    it("should throw on error", async () => {
      mockGh.mockResolvedValueOnce({
        stdout: "",
        stderr: "Project not found",
        exitCode: 1,
      });

      await expect(getProjectItems("owner", 999)).rejects.toThrow(
        "Failed to get project items"
      );
    });
  });

  describe("addIssueToProject", () => {
    it("should add issue to project and return item id", async () => {
      mockGh.mockResolvedValueOnce({
        stdout: JSON.stringify({ id: "PVTI_123" }),
        stderr: "",
        exitCode: 0,
      });

      const result = await addIssueToProject(
        "Pr0gCat",
        8,
        "https://github.com/Pr0gCat/haunted/issues/10"
      );

      expect(mockGh).toHaveBeenCalledWith([
        "project",
        "item-add",
        "8",
        "--owner",
        "Pr0gCat",
        "--url",
        "https://github.com/Pr0gCat/haunted/issues/10",
        "--format",
        "json",
      ]);

      expect(result).toBe("PVTI_123");
    });

    it("should throw on error", async () => {
      mockGh.mockResolvedValueOnce({
        stdout: "",
        stderr: "Cannot add item to project",
        exitCode: 1,
      });

      await expect(
        addIssueToProject("owner", 8, "https://github.com/owner/repo/issues/1")
      ).rejects.toThrow("Failed to add issue to project");
    });
  });

  describe("getProjectFields", () => {
    it("should list project fields", async () => {
      const mockFields = {
        fields: [
          { id: "FIELD_1", name: "Title" },
          {
            id: "FIELD_2",
            name: "Status",
            options: [
              { id: "OPT_1", name: "Backlog" },
              { id: "OPT_2", name: "In Progress" },
              { id: "OPT_3", name: "Done" },
            ],
          },
        ],
      };

      mockGh.mockResolvedValueOnce({
        stdout: JSON.stringify(mockFields),
        stderr: "",
        exitCode: 0,
      });

      const result = await getProjectFields("Pr0gCat", 8);

      expect(mockGh).toHaveBeenCalledWith([
        "project",
        "field-list",
        "8",
        "--owner",
        "Pr0gCat",
        "--format",
        "json",
      ]);

      expect(result).toHaveLength(2);
      expect(result[1]?.options).toHaveLength(3);
    });

    it("should throw on error", async () => {
      mockGh.mockResolvedValueOnce({
        stdout: "",
        stderr: "Project not found",
        exitCode: 1,
      });

      await expect(getProjectFields("owner", 999)).rejects.toThrow(
        "Failed to get project fields"
      );
    });
  });

  describe("moveItemToColumn", () => {
    it("should move item to specified column", async () => {
      // First call: get project fields
      const mockFields = {
        fields: [
          {
            id: "FIELD_STATUS",
            name: "Status",
            options: [
              { id: "OPT_BACKLOG", name: "Backlog" },
              { id: "OPT_IN_PROGRESS", name: "In Progress" },
              { id: "OPT_DONE", name: "Done" },
            ],
          },
        ],
      };

      mockGh
        .mockResolvedValueOnce({
          stdout: JSON.stringify(mockFields),
          stderr: "",
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          stdout: "",
          stderr: "",
          exitCode: 0,
        });

      await moveItemToColumn("Pr0gCat", 8, "ITEM_1", "In Progress");

      expect(mockGh).toHaveBeenCalledTimes(2);
      expect(mockGh).toHaveBeenLastCalledWith([
        "project",
        "item-edit",
        "--id",
        "ITEM_1",
        "--project-id",
        "8",
        "--field-id",
        "FIELD_STATUS",
        "--single-select-option-id",
        "OPT_IN_PROGRESS",
      ]);
    });

    it("should match column name case-insensitively", async () => {
      const mockFields = {
        fields: [
          {
            id: "FIELD_STATUS",
            name: "Status",
            options: [{ id: "OPT_DONE", name: "Done" }],
          },
        ],
      };

      mockGh
        .mockResolvedValueOnce({
          stdout: JSON.stringify(mockFields),
          stderr: "",
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          stdout: "",
          stderr: "",
          exitCode: 0,
        });

      await moveItemToColumn("owner", 8, "ITEM_1", "done"); // lowercase

      expect(mockGh).toHaveBeenLastCalledWith(
        expect.arrayContaining(["--single-select-option-id", "OPT_DONE"])
      );
    });

    it("should throw if Status field not found", async () => {
      const mockFields = {
        fields: [{ id: "FIELD_1", name: "Title" }],
      };

      mockGh.mockResolvedValueOnce({
        stdout: JSON.stringify(mockFields),
        stderr: "",
        exitCode: 0,
      });

      await expect(
        moveItemToColumn("owner", 8, "ITEM_1", "Done")
      ).rejects.toThrow("Project does not have a Status field");
    });

    it("should throw if column not found", async () => {
      const mockFields = {
        fields: [
          {
            id: "FIELD_STATUS",
            name: "Status",
            options: [{ id: "OPT_DONE", name: "Done" }],
          },
        ],
      };

      mockGh.mockResolvedValueOnce({
        stdout: JSON.stringify(mockFields),
        stderr: "",
        exitCode: 0,
      });

      await expect(
        moveItemToColumn("owner", 8, "ITEM_1", "NonExistent")
      ).rejects.toThrow('Column "NonExistent" not found in project');
    });
  });
});

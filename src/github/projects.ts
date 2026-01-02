import { gh } from "@/github/cli.ts";
import { createLogger } from "@/utils/logger.ts";

const logger = createLogger("github-projects");

export interface Project {
  id: string;
  title: string;
  number: number;
  url: string;
}

export interface ProjectItem {
  id: string;
  title: string;
  status: string | null;
  type: "ISSUE" | "PULL_REQUEST" | "DRAFT_ISSUE";
  content: {
    number: number;
    repository: string;
  } | null;
}

export interface ProjectField {
  id: string;
  name: string;
  type?: string;
  options?: Array<{ id: string; name: string }>;
}

// 複雜度對應的預估天數
const COMPLEXITY_DAYS: Record<string, number> = {
  "complexity:low": 1,
  "complexity:medium": 3,
  "complexity:high": 7,
};

/**
 * 根據複雜度標籤計算目標日期
 */
export function calculateTargetDate(labels: string[], startDate: Date = new Date()): Date {
  const complexityLabel = labels.find((l) => l.startsWith("complexity:"));
  const days = complexityLabel ? COMPLEXITY_DAYS[complexityLabel] ?? 3 : 3;

  const targetDate = new Date(startDate);
  targetDate.setDate(targetDate.getDate() + days);
  return targetDate;
}

/**
 * 格式化日期為 YYYY-MM-DD
 */
export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function listProjects(owner: string): Promise<Project[]> {
  const result = await gh([
    "api",
    "graphql",
    "-f",
    `query=query {
      user(login: "${owner}") {
        projectsV2(first: 20) {
          nodes {
            id
            title
            number
            url
          }
        }
      }
    }`,
  ]);

  if (result.exitCode !== 0) {
    const orgResult = await gh([
      "api",
      "graphql",
      "-f",
      `query=query {
        organization(login: "${owner}") {
          projectsV2(first: 20) {
            nodes {
              id
              title
              number
              url
            }
          }
        }
      }`,
    ]);

    if (orgResult.exitCode !== 0) {
      throw new Error(`Failed to list projects: ${orgResult.stderr}`);
    }

    const orgData = JSON.parse(orgResult.stdout);
    return orgData.data.organization.projectsV2.nodes;
  }

  const data = JSON.parse(result.stdout);
  return data.data.user.projectsV2.nodes;
}

export async function getProject(owner: string, projectNumber: number): Promise<Project | null> {
  const projects = await listProjects(owner);
  return projects.find((p) => p.number === projectNumber) ?? null;
}

export async function getProjectItems(
  owner: string,
  projectNumber: number
): Promise<ProjectItem[]> {
  const result = await gh([
    "project",
    "item-list",
    String(projectNumber),
    "--owner",
    owner,
    "--format",
    "json",
  ]);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to get project items: ${result.stderr}`);
  }

  const data = JSON.parse(result.stdout);
  return data.items.map((item: Record<string, unknown>) => ({
    id: item.id,
    title: item.title,
    status: item.status ?? null,
    type: item.type,
    content: item.content,
  }));
}

export async function addIssueToProject(
  owner: string,
  projectNumber: number,
  issueUrl: string
): Promise<string> {
  const result = await gh([
    "project",
    "item-add",
    String(projectNumber),
    "--owner",
    owner,
    "--url",
    issueUrl,
    "--format",
    "json",
  ]);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to add issue to project: ${result.stderr}`);
  }

  const data = JSON.parse(result.stdout);
  logger.info({ owner, projectNumber, issueUrl }, "Issue added to project");
  return data.id;
}

export async function updateProjectItemStatus(
  owner: string,
  projectNumber: number,
  itemId: string,
  statusFieldId: string,
  statusOptionId: string
): Promise<void> {
  const result = await gh([
    "project",
    "item-edit",
    "--id",
    itemId,
    "--project-id",
    String(projectNumber),
    "--field-id",
    statusFieldId,
    "--single-select-option-id",
    statusOptionId,
  ]);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to update project item status: ${result.stderr}`);
  }

  logger.info({ owner, projectNumber, itemId }, "Project item status updated");
}

export async function getProjectFields(
  owner: string,
  projectNumber: number
): Promise<ProjectField[]> {
  const result = await gh([
    "project",
    "field-list",
    String(projectNumber),
    "--owner",
    owner,
    "--format",
    "json",
  ]);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to get project fields: ${result.stderr}`);
  }

  const data = JSON.parse(result.stdout);
  return data.fields;
}

export async function moveItemToColumn(
  owner: string,
  projectNumber: number,
  itemId: string,
  columnName: string
): Promise<void> {
  const fields = await getProjectFields(owner, projectNumber);

  const statusField = fields.find(
    (f) => f.name.toLowerCase() === "status" && f.options
  );

  if (!statusField) {
    throw new Error("Project does not have a Status field");
  }

  const option = statusField.options?.find(
    (o) => o.name.toLowerCase() === columnName.toLowerCase()
  );

  if (!option) {
    throw new Error(`Column "${columnName}" not found in project`);
  }

  await updateProjectItemStatus(owner, projectNumber, itemId, statusField.id, option.id);
}

/**
 * 根據 repo 和 issue number 找到對應的 project item
 */
export async function findProjectItemByIssue(
  owner: string,
  projectNumber: number,
  repo: string,
  issueNumber: number
): Promise<ProjectItem | null> {
  const items = await getProjectItems(owner, projectNumber);
  return (
    items.find(
      (item) =>
        item.content?.repository === repo && item.content?.number === issueNumber
    ) ?? null
  );
}

/**
 * 設定 project item 的日期欄位
 */
export async function setProjectItemDate(
  owner: string,
  projectNumber: number,
  itemId: string,
  fieldName: string,
  date: Date
): Promise<void> {
  const fields = await getProjectFields(owner, projectNumber);
  const dateField = fields.find(
    (f) => f.name.toLowerCase() === fieldName.toLowerCase()
  );

  if (!dateField) {
    throw new Error(`Date field "${fieldName}" not found in project`);
  }

  const result = await gh([
    "project",
    "item-edit",
    "--id",
    itemId,
    "--project-id",
    String(projectNumber),
    "--field-id",
    dateField.id,
    "--date",
    formatDate(date),
  ]);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to set date field: ${result.stderr}`);
  }

  logger.info(
    { owner, projectNumber, itemId, fieldName, date: formatDate(date) },
    "Project item date updated"
  );
}

/**
 * ProjectService - 封裝 Project Board 整合的高階操作
 */
export class ProjectService {
  private fieldsCache: Map<string, ProjectField[]> = new Map();

  constructor(
    private owner: string,
    private projectNumber: number
  ) {}

  private cacheKey(): string {
    return `${this.owner}/${this.projectNumber}`;
  }

  async getFields(): Promise<ProjectField[]> {
    const key = this.cacheKey();
    if (!this.fieldsCache.has(key)) {
      const fields = await getProjectFields(this.owner, this.projectNumber);
      this.fieldsCache.set(key, fields);
    }
    return this.fieldsCache.get(key)!;
  }

  /**
   * 新增 issue 到 project 並設定初始狀態
   */
  async addIssue(
    issueUrl: string,
    options: {
      status?: string;
      labels?: string[];
    } = {}
  ): Promise<string> {
    const itemId = await addIssueToProject(this.owner, this.projectNumber, issueUrl);

    // 設定初始狀態
    if (options.status) {
      await this.setStatus(itemId, options.status);
    }

    // 如果有 labels，計算並設定 target date
    if (options.labels && options.labels.length > 0) {
      const targetDate = calculateTargetDate(options.labels);
      await this.setDate(itemId, "Target Date", targetDate);
    }

    return itemId;
  }

  /**
   * 設定狀態欄位
   */
  async setStatus(itemId: string, status: string): Promise<void> {
    await moveItemToColumn(this.owner, this.projectNumber, itemId, status);
  }

  /**
   * 設定日期欄位
   */
  async setDate(itemId: string, fieldName: string, date: Date): Promise<void> {
    await setProjectItemDate(this.owner, this.projectNumber, itemId, fieldName, date);
  }

  /**
   * 根據 issue 找到對應的 project item
   */
  async findItemByIssue(repo: string, issueNumber: number): Promise<ProjectItem | null> {
    return findProjectItemByIssue(this.owner, this.projectNumber, repo, issueNumber);
  }

  /**
   * 標記 issue 開始處理
   */
  async markInProgress(repo: string, issueNumber: number, labels: string[] = []): Promise<void> {
    const item = await this.findItemByIssue(repo, issueNumber);
    if (!item) {
      logger.warn({ repo, issueNumber }, "Issue not found in project, skipping status update");
      return;
    }

    const now = new Date();
    await this.setStatus(item.id, "In Progress");
    await this.setDate(item.id, "Start Date", now);

    // 根據複雜度設定目標日期
    if (labels.length > 0) {
      const targetDate = calculateTargetDate(labels, now);
      await this.setDate(item.id, "Target Date", targetDate);
    }

    logger.info({ repo, issueNumber }, "Issue marked as In Progress with dates");
  }

  /**
   * 標記 issue 完成
   */
  async markDone(repo: string, issueNumber: number): Promise<void> {
    const item = await this.findItemByIssue(repo, issueNumber);
    if (!item) {
      logger.warn({ repo, issueNumber }, "Issue not found in project, skipping status update");
      return;
    }

    await this.setStatus(item.id, "Done");

    logger.info({ repo, issueNumber }, "Issue marked as Done");
  }
}

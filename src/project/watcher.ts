import { createLogger } from "@/utils/logger.ts";
import { gh } from "@/github/cli.ts";
import type { Config } from "@/config/schema.ts";

const logger = createLogger("project-watcher");

export interface ScheduledTask {
  itemId: string;
  issueNumber: number;
  repo: string;
  title: string;
  priority: string | null;
  startDate: string | null;
  targetDate: string | null;
  status: string;
  executor: string | null;
}

interface ProjectItem {
  id: string;
  title: string;
  status: string | null;
  priority?: string | null;
  executor?: string | null;
  startDate?: string | null;
  targetDate?: string | null;
  content: {
    number: number;
    repository: string;
    type: "Issue" | "PullRequest";
  } | null;
}

/**
 * ProjectWatcher - 監控 Project Board 並找出待處理的任務
 *
 * 處理邏輯：
 * 1. Kanban 模式: Status = "Todo" 且 Executor = "haunted"
 * 2. Roadmap 模式: Start Date <= 今天 且 Executor = "haunted"
 */
export class ProjectWatcher {
  private owner: string;
  private projectNumber: number;

  constructor(config: Config) {
    this.owner = config.scope.target;
    this.projectNumber = config.project.number!;
  }

  /**
   * 取得所有待處理的任務
   */
  async getScheduledTasks(): Promise<ScheduledTask[]> {
    const items = await this.getProjectItems();
    const today = new Date().toISOString().slice(0, 10);

    const tasks: ScheduledTask[] = [];

    for (const item of items) {
      // 只處理 Issue，不處理 PR
      if (!item.content || item.content.type !== "Issue") {
        continue;
      }

      // 只處理指派給 haunted 的項目
      if (item.executor !== "haunted") {
        continue;
      }

      const shouldProcess = this.shouldProcessItem(item, today);

      if (shouldProcess) {
        tasks.push({
          itemId: item.id,
          issueNumber: item.content.number,
          repo: item.content.repository,
          title: item.title,
          priority: item.priority ?? null,
          startDate: item.startDate ?? null,
          targetDate: item.targetDate ?? null,
          status: item.status ?? "Unknown",
          executor: item.executor,
        });
      }
    }

    // 按優先級排序: P0 > P1 > P2 > P3
    tasks.sort((a, b) => {
      const priorityOrder = ["P0 - Critical", "P1 - High", "P2 - Medium", "P3 - Low"];
      const aIndex = a.priority ? priorityOrder.indexOf(a.priority) : 999;
      const bIndex = b.priority ? priorityOrder.indexOf(b.priority) : 999;
      return aIndex - bIndex;
    });

    return tasks;
  }

  /**
   * 判斷是否應該處理這個項目
   */
  private shouldProcessItem(item: ProjectItem, today: string): boolean {
    // 已經在處理中或已完成的不處理
    if (item.status === "In Progress" || item.status === "Done" || item.status === "Review") {
      return false;
    }

    // Kanban 模式: Status = "Todo"
    if (item.status === "Todo") {
      return true;
    }

    // Roadmap 模式: Start Date <= 今天
    if (item.startDate && item.startDate <= today) {
      return true;
    }

    return false;
  }

  /**
   * 取得 Project 中的所有項目（包含自訂欄位）
   */
  private async getProjectItems(): Promise<ProjectItem[]> {
    // 使用 GraphQL 取得完整的項目資訊
    const query = `query($owner: String!, $number: Int!) {
      organization(login: $owner) {
        projectV2(number: $number) {
          items(first: 100) {
            nodes {
              id
              fieldValues(first: 20) {
                nodes {
                  ... on ProjectV2ItemFieldTextValue {
                    text
                    field { ... on ProjectV2FieldCommon { name } }
                  }
                  ... on ProjectV2ItemFieldDateValue {
                    date
                    field { ... on ProjectV2FieldCommon { name } }
                  }
                  ... on ProjectV2ItemFieldSingleSelectValue {
                    name
                    field { ... on ProjectV2FieldCommon { name } }
                  }
                }
              }
              content {
                ... on Issue {
                  number
                  title
                  repository { nameWithOwner }
                }
                ... on PullRequest {
                  number
                  title
                  repository { nameWithOwner }
                }
              }
            }
          }
        }
      }
    }`;

    const result = await gh([
      "api",
      "graphql",
      "-f",
      `query=${query}`,
      "-f",
      `owner=${this.owner}`,
      "-F",
      `number=${this.projectNumber}`,
    ]);

    if (result.exitCode !== 0) {
      logger.error({ stderr: result.stderr }, "Failed to fetch project items");
      return [];
    }

    const data = JSON.parse(result.stdout);
    const items = data.data?.organization?.projectV2?.items?.nodes ?? [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return items.map((item: any) => {
      const fields: Record<string, string | null> = {};

      for (const fieldValue of item.fieldValues?.nodes ?? []) {
        const fieldName = fieldValue?.field?.name;
        if (!fieldName) continue;

        if (fieldValue.text !== undefined) {
          fields[fieldName] = fieldValue.text;
        } else if (fieldValue.date !== undefined) {
          fields[fieldName] = fieldValue.date;
        } else if (fieldValue.name !== undefined) {
          fields[fieldName] = fieldValue.name;
        }
      }

      const content = item.content;
      const repository = content?.repository as { nameWithOwner?: string } | undefined;

      return {
        id: item.id,
        title: fields["Title"] ?? content?.title ?? "Untitled",
        status: fields["Status"] ?? null,
        priority: fields["Priority"] ?? null,
        executor: fields["Executor"] ?? null,
        startDate: fields["Start Date"] ?? null,
        targetDate: fields["Target Date"] ?? null,
        content: content
          ? {
              number: content.number,
              repository: repository?.nameWithOwner ?? "",
              type: content.__typename === "PullRequest" ? "PullRequest" : "Issue",
            }
          : null,
      } as ProjectItem;
    });
  }
}

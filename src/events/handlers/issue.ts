import { createLogger } from "@/utils/logger.ts";
import type { GitHubEvent, IssueEventPayload } from "@/events/types.ts";
import type { Config } from "@/config/schema.ts";
import type { Orchestrator } from "@/agents/orchestrator.ts";
import { ProjectService } from "@/github/projects.ts";

const logger = createLogger("issue-handler");

export function createIssueHandlers(config: Config, orchestrator: Orchestrator) {
  // 建立 ProjectService 實例（如果啟用）
  const projectService =
    config.project.enabled && config.project.number
      ? new ProjectService(config.scope.target, config.project.number)
      : null;

  // Project 驅動模式：只分析不自動實作
  const projectDriven = config.project.enabled && config.project.driven;

  async function handleIssueOpened(event: GitHubEvent): Promise<void> {
    const payload = event.payload as unknown as IssueEventPayload;
    const { issue, repository } = payload;
    const repo = repository.full_name;

    logger.info({ repo, number: issue.number, title: issue.title }, "New issue opened");

    const labels = issue.labels.map((l) => l.name);

    // Add issue to project board if configured
    if (projectService) {
      try {
        // Project 驅動模式下，新 issue 加到 Backlog
        const initialStatus = projectDriven ? "Backlog" : "Todo";
        await projectService.addIssue(issue.html_url, {
          status: initialStatus,
          labels,
        });
        logger.info(
          { repo, number: issue.number, projectNumber: config.project.number, status: initialStatus },
          "Issue added to project board"
        );
      } catch (error) {
        logger.error({ error, number: issue.number }, "Failed to add issue to project");
      }
    }

    if (labels.includes(config.labels.human_only)) {
      logger.info({ number: issue.number }, "Issue marked for human-only, skipping");
      return;
    }

    if (labels.includes(config.labels.skip)) {
      logger.info({ number: issue.number }, "Issue has skip label, skipping");
      return;
    }

    // Project 驅動模式：只分析加 labels，不自動實作
    if (projectDriven) {
      await orchestrator.analyzeIssue({
        repo,
        number: issue.number,
        title: issue.title,
        body: issue.body ?? "",
        labels,
        author: issue.user.login,
      });
      logger.info({ number: issue.number }, "Issue analyzed, waiting for scheduling in Project Board");
      return;
    }

    // 傳統模式：自動實作
    await orchestrator.processIssue({
      repo,
      number: issue.number,
      title: issue.title,
      body: issue.body ?? "",
      labels,
      author: issue.user.login,
    });
  }

  async function handleIssueClosed(event: GitHubEvent): Promise<void> {
    const payload = event.payload as unknown as IssueEventPayload;
    const { issue, repository } = payload;
    const repo = repository.full_name;

    logger.info({ repo, number: issue.number }, "Issue closed");

    // 更新 Project Board 狀態為 Done
    if (projectService) {
      try {
        await projectService.markDone(repo, issue.number);
      } catch (error) {
        logger.error({ error, number: issue.number }, "Failed to mark issue as Done in project");
      }
    }

    await orchestrator.cancelIssueProcessing(repo, issue.number);
  }

  async function handleIssueLabeled(event: GitHubEvent): Promise<void> {
    const payload = event.payload as unknown as IssueEventPayload;
    const { issue, repository } = payload;
    const labels = issue.labels.map((l) => l.name);

    if (labels.includes(config.labels.human_only)) {
      logger.info(
        { repo: repository.full_name, number: issue.number },
        "Issue now marked human-only, cancelling AI processing"
      );
      await orchestrator.cancelIssueProcessing(repository.full_name, issue.number);
    }
  }

  return {
    handleIssueOpened,
    handleIssueClosed,
    handleIssueLabeled,
  };
}

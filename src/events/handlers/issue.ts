import { createLogger } from "@/utils/logger.ts";
import type { GitHubEvent, IssueEventPayload } from "@/events/types.ts";
import type { Config } from "@/config/schema.ts";
import type { Orchestrator } from "@/agents/orchestrator.ts";

const logger = createLogger("issue-handler");

export function createIssueHandlers(config: Config, orchestrator: Orchestrator) {
  async function handleIssueOpened(event: GitHubEvent): Promise<void> {
    const payload = event.payload as unknown as IssueEventPayload;
    const { issue, repository } = payload;
    const repo = repository.full_name;

    logger.info({ repo, number: issue.number, title: issue.title }, "New issue opened");

    const labels = issue.labels.map((l) => l.name);

    if (labels.includes(config.labels.human_only)) {
      logger.info({ number: issue.number }, "Issue marked for human-only, skipping");
      return;
    }

    if (labels.includes(config.labels.skip)) {
      logger.info({ number: issue.number }, "Issue has skip label, skipping");
      return;
    }

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

    logger.info(
      { repo: repository.full_name, number: issue.number },
      "Issue closed"
    );

    await orchestrator.cancelIssueProcessing(repository.full_name, issue.number);
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

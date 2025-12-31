import { createLogger } from "@/utils/logger.ts";
import type { GitHubEvent, IssueEventPayload } from "@/events/types.ts";
import type { Config } from "@/config/schema.ts";
import type { Orchestrator } from "@/agents/orchestrator.ts";
import { addIssueToProject } from "@/github/projects.ts";

const logger = createLogger("issue-handler");

export function createIssueHandlers(config: Config, orchestrator: Orchestrator) {
  /**
   * Automatically add an issue to the configured GitHub Project board.
   * This runs independently of other issue processing.
   */
  async function addIssueToProjectBoard(issueUrl: string, issueNumber: number): Promise<void> {
    const { project } = config;

    // Skip if project integration is disabled or not configured
    if (!project.enabled || !project.number || !project.owner || !project.auto_add_issues) {
      logger.debug({ issueNumber }, "Project auto-add disabled or not configured");
      return;
    }

    try {
      const itemId = await addIssueToProject(project.owner, project.number, issueUrl);
      logger.info(
        { issueNumber, projectNumber: project.number, projectOwner: project.owner, itemId },
        "Issue automatically added to project board"
      );
    } catch (error) {
      // Log error but don't fail the whole issue handling
      logger.warn(
        { issueNumber, projectNumber: project.number, error },
        "Failed to add issue to project board"
      );
    }
  }

  async function handleIssueOpened(event: GitHubEvent): Promise<void> {
    const payload = event.payload as unknown as IssueEventPayload;
    const { issue, repository } = payload;
    const repo = repository.full_name;

    logger.info({ repo, number: issue.number, title: issue.title }, "New issue opened");

    // Automatically add issue to project board (non-blocking)
    addIssueToProjectBoard(issue.html_url, issue.number).catch((error) => {
      logger.error({ error, issueNumber: issue.number }, "Unexpected error adding issue to project");
    });

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

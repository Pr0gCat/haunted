import { loadConfig } from "@/config/loader.ts";
import type { Config } from "@/config/schema.ts";
import { createLogger } from "@/utils/logger.ts";
import { createWebhookServer } from "@/events/webhook-server.ts";
import { Poller } from "@/events/poller.ts";
import { EventRouter } from "@/events/event-router.ts";
import { Orchestrator } from "@/agents/orchestrator.ts";
import { createIssueHandlers } from "@/events/handlers/issue.ts";
import { createPRHandlers } from "@/events/handlers/pull-request.ts";
import { createCommentHandlers } from "@/events/handlers/comment.ts";
import { checkGhAuth, getGhUser, gh } from "@/github/cli.ts";
import { ensureLabels, type LabelDefinition } from "@/github/issues.ts";
import { ProjectWatcher } from "@/project/watcher.ts";
import { getIssue } from "@/github/issues.ts";
import { listOrgRepos, checkProjectPermission } from "@/github/index.ts";

// 支援 Manager 環境下的 instance ID 標識
const instanceId = process.env.HAUNTED_INSTANCE_ID;
const loggerName = instanceId ? `main:${instanceId}` : "main";
const logger = createLogger(loggerName);

function collectLabels(config: Config): LabelDefinition[] {
  const allLabels: LabelDefinition[] = [];

  // Collect all issue type labels
  for (const label of Object.values(config.labels.issue_types)) {
    allLabels.push(label);
  }

  // Collect all complexity labels
  for (const label of Object.values(config.labels.complexity)) {
    allLabels.push(label);
  }

  // Collect all priority labels
  for (const label of Object.values(config.labels.priority)) {
    allLabels.push(label);
  }

  // Add system labels
  allLabels.push({ name: config.labels.human_only, color: "e99695", description: "Requires human attention" });
  allLabels.push({ name: config.labels.skip, color: "cfd3d7", description: "Skip AI processing" });
  allLabels.push({ name: config.labels.auto_merge, color: "0e8a16", description: "Auto-merge when checks pass" });
  allLabels.push({ name: config.labels.needs_review, color: "fbca04", description: "Needs human review" });

  // Add commonly suggested labels
  allLabels.push({ name: "ai-ready", color: "5319e7", description: "Ready for AI to implement" });
  allLabels.push({ name: "good first issue", color: "7057ff", description: "Good for newcomers" });
  allLabels.push({ name: "help wanted", color: "008672", description: "Extra attention is needed" });
  allLabels.push({ name: "wontfix", color: "ffffff", description: "This will not be worked on" });
  allLabels.push({ name: "duplicate", color: "cfd3d7", description: "This issue or PR already exists" });
  allLabels.push({ name: "invalid", color: "e4e669", description: "This doesn't seem right" });

  return allLabels;
}

async function initializeLabels(config: Config): Promise<void> {
  if (!config.labels.auto_label) {
    logger.debug("Auto-labeling disabled, skipping label initialization");
    return;
  }

  const allLabels = collectLabels(config);

  if (config.scope.type === "repo") {
    logger.info({ repo: config.scope.target, count: allLabels.length }, "Ensuring labels exist on repository");
    await ensureLabels(config.scope.target, allLabels);
  } else {
    // Organization scope - ensure labels on all repos
    const repos = await listOrgRepos(config.scope.target);
    logger.info({ org: config.scope.target, repoCount: repos.length, labelCount: allLabels.length }, "Ensuring labels exist on organization repos");

    for (const repo of repos) {
      try {
        await ensureLabels(repo, allLabels);
        logger.debug({ repo }, "Labels ensured");
      } catch (error) {
        logger.warn({ repo, error }, "Failed to ensure labels on repo");
      }
    }
  }
}

async function main() {
  logger.info("🏚️ Starting Haunted...");

  const ghAuthed = await checkGhAuth();
  if (!ghAuthed) {
    logger.error("GitHub CLI not authenticated. Run 'gh auth login' first.");
    process.exit(1);
  }

  const ghUser = await getGhUser();
  logger.info({ user: ghUser }, "Authenticated with GitHub");

  const config = await loadConfig();

  logger.info(
    { scope: config.scope, webhook: config.github.webhook.enabled, polling: config.github.polling.enabled },
    "Configuration loaded"
  );

  // Ensure all configured labels exist on the repository
  await initializeLabels(config);

  const repoPath = process.env.REPO_PATH || process.cwd();
  logger.info({ repoPath }, "Using repository path");

  const orchestrator = new Orchestrator(config, repoPath);
  await orchestrator.init();

  const router = new EventRouter(config);

  const issueHandlers = createIssueHandlers(config, orchestrator);
  router.onAction("issues", "opened", issueHandlers.handleIssueOpened);
  router.onAction("issues", "closed", issueHandlers.handleIssueClosed);
  router.onAction("issues", "labeled", issueHandlers.handleIssueLabeled);

  const prHandlers = createPRHandlers(config, orchestrator);
  router.onAction("pull_request", "opened", prHandlers.handlePROpened);
  router.onAction("pull_request", "closed", prHandlers.handlePRClosed);
  router.onAction("pull_request_review", "submitted", prHandlers.handlePRReview);

  const commentHandlers = createCommentHandlers(config, orchestrator);
  router.onAction("issue_comment", "created", commentHandlers.handleCommentCreated);

  const eventHandler = router.handle.bind(router);

  if (config.github.webhook.enabled) {
    const webhookServer = createWebhookServer(config, eventHandler);
    webhookServer.start();
  }

  let poller: Poller | null = null;
  if (config.github.polling.enabled) {
    poller = new Poller(config, eventHandler);
    poller.start();
  }

  // Project 驅動模式：啟動 ProjectWatcher
  let projectWatcherInterval: ReturnType<typeof setInterval> | null = null;
  if (config.project.enabled && config.project.driven && config.project.number) {
    // Check if we have project permission first
    const hasProjectPermission = await checkProjectPermission(config.scope.target, config.project.number);

    if (!hasProjectPermission) {
      logger.warn(
        { owner: config.scope.target, projectNumber: config.project.number },
        "Missing 'read:project' permission. Project-driven mode disabled. Run 'gh auth refresh -s read:project' to enable."
      );
    } else {
      const projectWatcher = new ProjectWatcher(config);
      const pollInterval = config.github.polling.interval * 1000;

      const checkScheduledTasks = async () => {
        try {
          const tasks = await projectWatcher.getScheduledTasks();
          if (tasks.length > 0) {
            logger.info({ count: tasks.length }, "Found scheduled tasks in Project Board");

            for (const task of tasks) {
              const issue = await getIssue(task.repo, task.issueNumber);
              await orchestrator.executeScheduledTask({
                repo: task.repo,
                number: task.issueNumber,
                title: task.title,
                body: issue.body,
                labels: issue.labels,
                author: issue.author,
              });
            }
          }
        } catch (error) {
          logger.error({ error }, "Failed to check scheduled tasks");
        }
      };

      // 立即執行一次，然後定期輪詢
      checkScheduledTasks();
      projectWatcherInterval = setInterval(checkScheduledTasks, pollInterval);
      logger.info({ interval: pollInterval }, "Project-driven mode enabled, watching for scheduled tasks");
    }
  }

  logger.info("🏚️ Haunted is now watching your repository...");

  const shutdown = async () => {
    logger.info("Shutting down...");

    if (poller) {
      poller.stop();
    }

    if (projectWatcherInterval) {
      clearInterval(projectWatcherInterval);
    }

    await orchestrator.cleanup();

    logger.info("Goodbye! 👻");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  logger.error({ error }, "Fatal error");
  process.exit(1);
});

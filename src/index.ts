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
import { checkGhAuth, getGhUser } from "@/github/cli.ts";
import { ensureLabels, type LabelDefinition } from "@/github/issues.ts";

const logger = createLogger("main");

async function initializeLabels(config: Config): Promise<void> {
  const repo = config.scope.type === "repo" ? config.scope.target : null;
  if (!repo) {
    logger.debug("Skipping label initialization for organization scope");
    return;
  }

  if (!config.labels.auto_label) {
    logger.debug("Auto-labeling disabled, skipping label initialization");
    return;
  }

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

  logger.info({ count: allLabels.length }, "Ensuring labels exist on repository");
  await ensureLabels(repo, allLabels);
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

  const repoPath = process.cwd();

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

  logger.info("🏚️ Haunted is now watching your repository...");

  const shutdown = async () => {
    logger.info("Shutting down...");

    if (poller) {
      poller.stop();
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

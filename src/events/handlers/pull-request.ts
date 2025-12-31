import { createLogger } from "@/utils/logger.ts";
import type { GitHubEvent, PullRequestEventPayload, PullRequestReviewEventPayload } from "@/events/types.ts";
import type { Config } from "@/config/schema.ts";
import type { Orchestrator } from "@/agents/orchestrator.ts";
import { mergePullRequest } from "@/github/pull-requests.ts";

const logger = createLogger("pr-handler");

export function createPRHandlers(config: Config, orchestrator: Orchestrator) {
  async function handlePROpened(event: GitHubEvent): Promise<void> {
    const payload = event.payload as unknown as PullRequestEventPayload;
    const { pull_request, repository } = payload;
    const repo = repository.full_name;

    logger.info(
      { repo, number: pull_request.number, title: pull_request.title },
      "New PR opened"
    );

    if (pull_request.head.ref.startsWith(config.agents.claude_code.branch_prefix)) {
      logger.info({ number: pull_request.number }, "PR created by haunted, triggering code review");

      if (config.agents.house_master.auto_review) {
        await orchestrator.reviewPullRequest({
          repo,
          number: pull_request.number,
          title: pull_request.title,
          body: pull_request.body ?? "",
          headBranch: pull_request.head.ref,
          baseBranch: pull_request.base.ref,
          author: pull_request.user.login,
        });
      }
    }
  }

  async function handlePRClosed(event: GitHubEvent): Promise<void> {
    const payload = event.payload as unknown as PullRequestEventPayload;
    const { pull_request, repository } = payload;

    if (pull_request.merged) {
      logger.info(
        { repo: repository.full_name, number: pull_request.number },
        "PR merged"
      );

      await orchestrator.handlePRMerged(repository.full_name, pull_request.number);
    } else {
      logger.info(
        { repo: repository.full_name, number: pull_request.number },
        "PR closed without merge"
      );
    }
  }

  async function handlePRReview(event: GitHubEvent): Promise<void> {
    const payload = event.payload as unknown as PullRequestReviewEventPayload;
    const { review, pull_request, repository } = payload;
    const repo = repository.full_name;

    logger.info(
      { repo, number: pull_request.number, reviewState: review.state },
      "PR review received"
    );

    if (review.state === "approved") {
      await checkAutoMerge(repo, pull_request.number);
    }
  }

  async function checkAutoMerge(repo: string, prNumber: number): Promise<void> {
    const { auto_merge, rules } = config.pull_requests;

    if (!auto_merge.enabled) {
      const { getPullRequest } = await import("@/github/pull-requests.ts");
      const pr = await getPullRequest(repo, prNumber);
      const labels = pr.labels;

      const matchingRule = rules.find((rule) => labels.includes(rule.label));

      if (!matchingRule?.auto_merge) {
        logger.info({ repo, prNumber }, "Auto-merge not enabled for this PR");
        return;
      }
    }

    logger.info({ repo, prNumber }, "Attempting auto-merge");

    try {
      await mergePullRequest(repo, prNumber, {
        method: "squash",
        deleteAfter: true,
      });
    } catch (error) {
      logger.error({ error, repo, prNumber }, "Auto-merge failed");
    }
  }

  return {
    handlePROpened,
    handlePRClosed,
    handlePRReview,
    checkAutoMerge,
  };
}

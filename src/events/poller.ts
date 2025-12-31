import { gh } from "@/github/cli.ts";
import { createLogger } from "@/utils/logger.ts";
import type { Config } from "@/config/schema.ts";
import type { GitHubEvent, EventHandler } from "@/events/types.ts";

const logger = createLogger("poller");

interface RepoState {
  lastIssueCheck: Date;
  lastPRCheck: Date;
  processedEvents: Set<string>;
}

export class Poller {
  private config: Config;
  private handler: EventHandler;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private repoStates: Map<string, RepoState> = new Map();

  constructor(config: Config, handler: EventHandler) {
    this.config = config;
    this.handler = handler;
  }

  start(): void {
    if (this.intervalId) {
      logger.warn("Poller already running");
      return;
    }

    const intervalMs = this.config.github.polling.interval * 1000;
    logger.info({ intervalMs }, "Starting poller");

    this.poll();
    this.intervalId = setInterval(() => this.poll(), intervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info("Poller stopped");
    }
  }

  private getOrCreateState(repo: string): RepoState {
    let state = this.repoStates.get(repo);
    if (!state) {
      // Set to epoch so first poll picks up all open issues
      state = {
        lastIssueCheck: new Date(0),
        lastPRCheck: new Date(0),
        processedEvents: new Set(),
      };
      this.repoStates.set(repo, state);
    }
    return state;
  }

  private async poll(): Promise<void> {
    const { scope } = this.config;

    try {
      if (scope.type === "repo") {
        await this.pollRepo(scope.target);
      } else {
        await this.pollOrganization(scope.target);
      }
    } catch (error) {
      logger.error({ error }, "Polling failed");
    }
  }

  private async pollRepo(repo: string): Promise<void> {
    logger.debug({ repo }, "Polling repository");

    await Promise.all([
      this.checkNewIssues(repo),
      this.checkNewPRs(repo),
      this.checkIssueUpdates(repo),
    ]);
  }

  private async pollOrganization(org: string): Promise<void> {
    const result = await gh(["repo", "list", org, "--json", "nameWithOwner", "--limit", "100"]);

    if (result.exitCode !== 0) {
      logger.error({ org, stderr: result.stderr }, "Failed to list org repos");
      return;
    }

    const repos = JSON.parse(result.stdout) as Array<{ nameWithOwner: string }>;

    for (const { nameWithOwner } of repos) {
      await this.pollRepo(nameWithOwner);
    }
  }

  private async checkNewIssues(repo: string): Promise<void> {
    const state = this.getOrCreateState(repo);

    const result = await gh([
      "issue",
      "list",
      "-R",
      repo,
      "--state",
      "open",
      "--json",
      "number,title,body,state,labels,createdAt,updatedAt",
      "--limit",
      "20",
    ]);

    if (result.exitCode !== 0) {
      return;
    }

    const issues = JSON.parse(result.stdout) as Array<{
      number: number;
      title: string;
      body: string;
      state: string;
      labels: Array<{ name: string }>;
      createdAt: string;
      updatedAt: string;
    }>;

    for (const issue of issues) {
      const eventId = `issue:${repo}:${issue.number}:${issue.updatedAt}`;

      if (state.processedEvents.has(eventId)) {
        continue;
      }

      const createdAt = new Date(issue.createdAt);
      const isNew = createdAt > state.lastIssueCheck;

      const event: GitHubEvent = {
        type: "issues",
        action: isNew ? "opened" : "edited",
        payload: {
          action: isNew ? "opened" : "edited",
          issue: {
            number: issue.number,
            title: issue.title,
            body: issue.body,
            state: issue.state,
            labels: issue.labels,
            user: { login: "unknown" },
            assignees: [],
            html_url: `https://github.com/${repo}/issues/${issue.number}`,
          },
          repository: {
            full_name: repo,
            default_branch: "main",
            owner: { login: repo.split("/")[0] },
          },
          sender: { login: "poller" },
        },
        deliveryId: `poll:${eventId}`,
        receivedAt: new Date(),
      };

      try {
        await this.handler(event);
        state.processedEvents.add(eventId);

        if (state.processedEvents.size > 1000) {
          const entries = Array.from(state.processedEvents);
          state.processedEvents = new Set(entries.slice(-500));
        }
      } catch (error) {
        logger.error({ error, eventId }, "Failed to handle polled event");
      }
    }

    state.lastIssueCheck = new Date();
  }

  private async checkNewPRs(repo: string): Promise<void> {
    const state = this.getOrCreateState(repo);

    const result = await gh([
      "pr",
      "list",
      "-R",
      repo,
      "--state",
      "open",
      "--json",
      "number,title,body,state,labels,headRefName,baseRefName,createdAt,updatedAt",
      "--limit",
      "20",
    ]);

    if (result.exitCode !== 0) {
      return;
    }

    const prs = JSON.parse(result.stdout) as Array<{
      number: number;
      title: string;
      body: string;
      state: string;
      labels: Array<{ name: string }>;
      headRefName: string;
      baseRefName: string;
      createdAt: string;
      updatedAt: string;
    }>;

    for (const pr of prs) {
      const eventId = `pr:${repo}:${pr.number}:${pr.updatedAt}`;

      if (state.processedEvents.has(eventId)) {
        continue;
      }

      const createdAt = new Date(pr.createdAt);
      const isNew = createdAt > state.lastPRCheck;

      const event: GitHubEvent = {
        type: "pull_request",
        action: isNew ? "opened" : "synchronize",
        payload: {
          action: isNew ? "opened" : "synchronize",
          pull_request: {
            number: pr.number,
            title: pr.title,
            body: pr.body,
            state: pr.state,
            merged: false,
            labels: pr.labels,
            user: { login: "unknown" },
            head: { ref: pr.headRefName, sha: "" },
            base: { ref: pr.baseRefName },
            html_url: `https://github.com/${repo}/pull/${pr.number}`,
          },
          repository: {
            full_name: repo,
            default_branch: "main",
            owner: { login: repo.split("/")[0] },
          },
          sender: { login: "poller" },
        },
        deliveryId: `poll:${eventId}`,
        receivedAt: new Date(),
      };

      try {
        await this.handler(event);
        state.processedEvents.add(eventId);
      } catch (error) {
        logger.error({ error, eventId }, "Failed to handle polled PR event");
      }
    }

    state.lastPRCheck = new Date();
  }

  private async checkIssueUpdates(repo: string): Promise<void> {
    // Capture the timestamp BEFORE making the API call to avoid race condition
    // with checkNewIssues updating lastIssueCheck
    const state = this.getOrCreateState(repo);
    const checkpointTime = new Date(state.lastIssueCheck.getTime());

    const result = await gh([
      "api",
      `repos/${repo}/events`,
      "--jq",
      '.[] | select(.type == "IssueCommentEvent" or .type == "IssuesEvent") | {type: .type, payload: .payload, created_at: .created_at}',
    ]);

    if (result.exitCode !== 0) {
      return;
    }

    if (!result.stdout.trim()) {
      return;
    }

    const events = result.stdout.trim().split("\n").map((line) => JSON.parse(line));

    for (const evt of events.slice(0, 10)) {
      const eventId = `api:${repo}:${evt.type}:${evt.created_at}`;

      if (state.processedEvents.has(eventId)) {
        continue;
      }

      const eventDate = new Date(evt.created_at);
      if (eventDate < checkpointTime) {
        continue;
      }

      if (evt.type === "IssueCommentEvent") {
        const event: GitHubEvent = {
          type: "issue_comment",
          action: evt.payload.action,
          payload: {
            ...evt.payload,
            repository: { full_name: repo, owner: { login: repo.split("/")[0] } },
          },
          deliveryId: `poll:${eventId}`,
          receivedAt: new Date(),
        };

        try {
          await this.handler(event);
          state.processedEvents.add(eventId);
        } catch (error) {
          logger.error({ error }, "Failed to handle comment event");
        }
      }
    }
  }
}

import { createLogger } from "@/utils/logger.ts";
import type { GitHubEvent, EventHandler } from "@/events/types.ts";
import type { Config } from "@/config/schema.ts";

const logger = createLogger("event-router");

export type EventHandlerMap = {
  [key: string]: EventHandler[];
};

export class EventRouter {
  private handlers: EventHandlerMap = {};
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  on(eventType: string, handler: EventHandler): void {
    if (!this.handlers[eventType]) {
      this.handlers[eventType] = [];
    }
    this.handlers[eventType]!.push(handler);
    logger.debug({ eventType }, "Handler registered");
  }

  onAction(eventType: string, action: string, handler: EventHandler): void {
    const key = `${eventType}:${action}`;
    if (!this.handlers[key]) {
      this.handlers[key] = [];
    }
    this.handlers[key]!.push(handler);
    logger.debug({ eventType, action }, "Action handler registered");
  }

  async handle(event: GitHubEvent): Promise<void> {
    const { type, action, payload } = event;

    if (this.shouldSkipEvent(event)) {
      logger.debug({ type, action }, "Event skipped");
      return;
    }

    const keys = [type];
    if (action) {
      keys.push(`${type}:${action}`);
    }

    logger.info({ type, action, deliveryId: event.deliveryId }, "Routing event");

    const handlersToRun: EventHandler[] = [];

    for (const key of keys) {
      const keyHandlers = this.handlers[key];
      if (keyHandlers) {
        handlersToRun.push(...keyHandlers);
      }
    }

    if (handlersToRun.length === 0) {
      logger.debug({ type, action }, "No handlers for event");
      return;
    }

    for (const handler of handlersToRun) {
      try {
        await handler(event);
      } catch (error) {
        logger.error({ error, type, action }, "Handler error");
      }
    }
  }

  private shouldSkipEvent(event: GitHubEvent): boolean {
    const { type, payload } = event;

    if (type === "issues" || type === "issue_comment") {
      const issue = (payload as { issue?: { labels?: Array<{ name: string }> } }).issue;
      if (issue?.labels) {
        const skipLabel = this.config.labels.skip;
        if (issue.labels.some((l) => l.name === skipLabel)) {
          logger.info({ type, skipLabel }, "Event has skip label");
          return true;
        }
      }
    }

    if (type === "issue_comment") {
      const comment = (payload as { comment?: { body?: string } }).comment;
      if (comment?.body?.includes("<!-- haunted:")) {
        logger.debug({ type }, "Skipping own comment");
        return true;
      }
    }

    return false;
  }
}

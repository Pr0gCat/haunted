import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { createLogger } from "@/utils/logger.ts";
import type { Config } from "@/config/schema.ts";
import type { GitHubEvent, EventHandler } from "@/events/types.ts";

const logger = createLogger("webhook-server");

function verifySignature(payload: string, signature: string, secret: string): boolean {
  const encoder = new TextEncoder();
  const key = encoder.encode(secret);
  const data = encoder.encode(payload);

  const hmac = new Bun.CryptoHasher("sha256", key);
  hmac.update(data);
  const expectedSignature = `sha256=${hmac.digest("hex")}`;

  return signature === expectedSignature;
}

export function createWebhookServer(config: Config, handler: EventHandler) {
  const app = new Hono();

  app.get("/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

  app.post("/webhook", async (c) => {
    const eventType = c.req.header("x-github-event");
    const deliveryId = c.req.header("x-github-delivery");
    const signature = c.req.header("x-hub-signature-256");

    logger.debug({ eventType, deliveryId }, "Received webhook");

    if (!eventType) {
      logger.warn("Missing x-github-event header");
      return c.json({ error: "Missing event type" }, 400);
    }

    const rawBody = await c.req.text();

    if (config.github.webhook.secret && signature) {
      if (!verifySignature(rawBody, signature, config.github.webhook.secret)) {
        logger.warn({ deliveryId }, "Invalid webhook signature");
        return c.json({ error: "Invalid signature" }, 401);
      }
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      logger.error("Failed to parse webhook payload");
      return c.json({ error: "Invalid JSON" }, 400);
    }

    const event: GitHubEvent = {
      type: eventType,
      action: payload.action as string | undefined,
      payload,
      deliveryId: deliveryId ?? crypto.randomUUID(),
      receivedAt: new Date(),
    };

    try {
      await handler(event);
      logger.info({ eventType, action: event.action, deliveryId }, "Webhook processed");
      return c.json({ status: "accepted" });
    } catch (error) {
      logger.error({ error, eventType, deliveryId }, "Failed to process webhook");
      return c.json({ error: "Processing failed" }, 500);
    }
  });

  return {
    app,
    start: () => {
      const port = config.github.webhook.port;
      logger.info({ port }, "Starting webhook server");
      serve({ fetch: app.fetch, port });
    },
  };
}

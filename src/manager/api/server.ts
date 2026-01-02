import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { logger as honoLogger } from "hono/logger";
import type { Supervisor } from "@/manager/supervisor.ts";
import type { MetricsCollector } from "@/manager/metrics/collector.ts";
import { createLogger } from "@/utils/logger.ts";

const logger = createLogger("manager-api");

export interface ApiServerConfig {
  port: number;
  host: string;
  auth?: {
    enabled: boolean;
    api_key?: string;
  };
}

export function createManagerApi(
  supervisor: Supervisor,
  metricsCollector: MetricsCollector,
  config: ApiServerConfig
) {
  const app = new Hono();

  // Middleware
  app.use("*", cors());
  app.use("*", honoLogger());

  // API Key 認證
  if (config.auth?.enabled && config.auth.api_key) {
    app.use("/api/*", async (c, next) => {
      const apiKey = c.req.header("X-API-Key");
      if (apiKey !== config.auth!.api_key) {
        return c.json({ error: "Unauthorized" }, 401);
      }
      await next();
    });
  }

  // Health check
  app.get("/health", (c) => {
    return c.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      instances: supervisor.getAllStates().length,
    });
  });

  // === Instances API ===

  // 列出所有 instances
  app.get("/api/instances", (c) => {
    const states = supervisor.getAllStates();
    return c.json({ instances: states });
  });

  // 取得單一 instance 狀態
  app.get("/api/instances/:id", (c) => {
    const id = c.req.param("id");
    const instance = supervisor.getInstance(id);

    if (!instance) {
      return c.json({ error: "Instance not found" }, 404);
    }

    return c.json(instance.getState());
  });

  // 啟動 instance
  app.post("/api/instances/:id/start", async (c) => {
    const id = c.req.param("id");

    try {
      await supervisor.startInstance(id);
      return c.json({ success: true, message: `Instance ${id} started` });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return c.json({ error: message }, 400);
    }
  });

  // 停止 instance
  app.post("/api/instances/:id/stop", async (c) => {
    const id = c.req.param("id");

    try {
      await supervisor.stopInstance(id);
      return c.json({ success: true, message: `Instance ${id} stopped` });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return c.json({ error: message }, 400);
    }
  });

  // 重啟 instance
  app.post("/api/instances/:id/restart", async (c) => {
    const id = c.req.param("id");

    try {
      await supervisor.restartInstance(id);
      return c.json({ success: true, message: `Instance ${id} restarted` });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return c.json({ error: message }, 400);
    }
  });

  // === Logs API ===

  // 取得 instance 日誌
  app.get("/api/instances/:id/logs", (c) => {
    const id = c.req.param("id");
    const limit = parseInt(c.req.query("limit") ?? "100");
    const offset = parseInt(c.req.query("offset") ?? "0");

    try {
      const logs = supervisor.getInstanceLogs(id, limit, offset);
      return c.json({ logs, count: logs.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return c.json({ error: message }, 404);
    }
  });

  // SSE 即時日誌串流
  app.get("/api/instances/:id/logs/stream", (c) => {
    const id = c.req.param("id");
    const instance = supervisor.getInstance(id);

    if (!instance) {
      return c.json({ error: "Instance not found" }, 404);
    }

    // Server-Sent Events
    return new Response(
      new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();

          const onLog = (data: { type: string; line: string }) => {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
            );
          };

          instance.on("log", onLog);

          // Cleanup on close
          c.req.raw.signal.addEventListener("abort", () => {
            instance.off("log", onLog);
            controller.close();
          });
        },
      }),
      {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      }
    );
  });

  // === Metrics API ===

  // 取得所有指標
  app.get("/api/metrics", (c) => {
    const metrics = metricsCollector.getAll();
    return c.json(metrics);
  });

  // 取得單一 instance 指標
  app.get("/api/instances/:id/metrics", (c) => {
    const id = c.req.param("id");
    const metrics = metricsCollector.getInstanceMetrics(id);

    if (!metrics) {
      return c.json({ error: "Instance not found" }, 404);
    }

    return c.json(metrics);
  });

  // === Management API ===

  // 啟動所有 instances
  app.post("/api/start-all", async (c) => {
    await supervisor.startAll();
    return c.json({ success: true, message: "All instances started" });
  });

  // 停止所有 instances
  app.post("/api/stop-all", async (c) => {
    await supervisor.stopAll();
    return c.json({ success: true, message: "All instances stopped" });
  });

  return {
    app,
    start: () => {
      logger.info(
        { port: config.port, host: config.host },
        "Starting Manager API server"
      );
      serve({
        fetch: app.fetch,
        port: config.port,
        hostname: config.host,
      });
    },
  };
}

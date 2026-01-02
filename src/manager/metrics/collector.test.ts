import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock bun module
vi.mock("bun", () => ({
  spawn: vi.fn(() => ({
    pid: 12345,
    stdout: null,
    stderr: null,
    exited: Promise.resolve(0),
    kill: vi.fn(),
  })),
}));

// Mock the logger
vi.mock("@/utils/logger.ts", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { MetricsCollector } from "./collector.ts";
import { Supervisor } from "../supervisor.ts";

describe("manager/metrics/collector", () => {
  let supervisor: Supervisor;
  let collector: MetricsCollector;

  beforeEach(() => {
    supervisor = new Supervisor({
      autoRestart: false,
      maxRestarts: 3,
      restartWindow: 5,
      healthCheckInterval: 60,
    });
    collector = new MetricsCollector(supervisor, 30);
  });

  afterEach(async () => {
    collector.stop();
    await supervisor.stopAll();
  });

  describe("MetricsCollector", () => {
    describe("getAll", () => {
      it("should return global metrics with no instances", () => {
        const metrics = collector.getAll();

        expect(metrics.global).toEqual({
          totalInstances: 0,
          runningInstances: 0,
          stoppedInstances: 0,
          crashedInstances: 0,
          totalIssuesProcessed: 0,
          totalPRsProcessed: 0,
          totalErrors: 0,
          uptimeSeconds: expect.any(Number),
        });
        expect(metrics.instances).toEqual([]);
        expect(metrics.collectedAt).toBeDefined();
      });

      it("should include instance metrics", async () => {
        await supervisor.addInstance({
          id: "test-1",
          name: "Test 1",
          enabled: true,
          workingDir: process.cwd(),
        });

        const metrics = collector.getAll();

        expect(metrics.global.totalInstances).toBe(1);
        expect(metrics.instances).toHaveLength(1);
        expect(metrics.instances[0]).toEqual({
          id: "test-1",
          name: "Test 1",
          status: "stopped",
          uptime: 0,
          restartCount: 0,
          issuesProcessed: 0,
          prsProcessed: 0,
          activeWorkers: 0,
          errors: 0,
          memoryUsage: undefined,
        });
      });

      it("should aggregate metrics from multiple instances", async () => {
        await supervisor.addInstance({
          id: "test-1",
          name: "Test 1",
          enabled: true,
          workingDir: process.cwd(),
        });
        await supervisor.addInstance({
          id: "test-2",
          name: "Test 2",
          enabled: true,
          workingDir: process.cwd(),
        });

        const metrics = collector.getAll();

        expect(metrics.global.totalInstances).toBe(2);
        expect(metrics.global.stoppedInstances).toBe(2);
        expect(metrics.instances).toHaveLength(2);
      });

      it("should track uptime", async () => {
        const startTime = Date.now();

        // Wait a bit
        await new Promise((resolve) => setTimeout(resolve, 100));

        const metrics = collector.getAll();

        expect(metrics.global.uptimeSeconds).toBeGreaterThanOrEqual(0);
      });
    });

    describe("getInstanceMetrics", () => {
      it("should return metrics for specific instance", async () => {
        await supervisor.addInstance({
          id: "test-1",
          name: "Test 1",
          enabled: true,
          workingDir: process.cwd(),
        });

        const metrics = collector.getInstanceMetrics("test-1");

        expect(metrics).not.toBeNull();
        expect(metrics?.id).toBe("test-1");
        expect(metrics?.name).toBe("Test 1");
        expect(metrics?.status).toBe("stopped");
      });

      it("should return null for non-existent instance", () => {
        const metrics = collector.getInstanceMetrics("non-existent");

        expect(metrics).toBeNull();
      });
    });

    describe("start/stop", () => {
      it("should start collecting metrics", () => {
        collector.start();

        // Should not throw
        expect(true).toBe(true);
      });

      it("should stop collecting metrics", () => {
        collector.start();
        collector.stop();

        // Should not throw
        expect(true).toBe(true);
      });

      it("should be safe to start multiple times", () => {
        collector.start();
        collector.start();
        collector.start();

        // Should not throw or create multiple timers
        expect(true).toBe(true);
      });

      it("should be safe to stop multiple times", () => {
        collector.start();
        collector.stop();
        collector.stop();
        collector.stop();

        // Should not throw
        expect(true).toBe(true);
      });
    });

    describe("collectedAt timestamp", () => {
      it("should have valid ISO timestamp", () => {
        const metrics = collector.getAll();

        expect(() => new Date(metrics.collectedAt)).not.toThrow();
        expect(new Date(metrics.collectedAt).toISOString()).toBe(
          metrics.collectedAt
        );
      });
    });
  });
});

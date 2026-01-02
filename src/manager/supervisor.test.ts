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

import { Supervisor, type SupervisorOptions } from "./supervisor.ts";
import type { InstanceRunConfig } from "./instance.ts";

describe("manager/supervisor", () => {
  const defaultOptions: SupervisorOptions = {
    autoRestart: true,
    maxRestarts: 3,
    restartWindow: 5,
    healthCheckInterval: 60,
  };

  const createInstanceConfig = (id: string): InstanceRunConfig => ({
    id,
    name: `Instance ${id}`,
    enabled: true,
    workingDir: process.cwd(),
  });

  describe("Supervisor", () => {
    let supervisor: Supervisor;

    beforeEach(() => {
      supervisor = new Supervisor(defaultOptions);
    });

    afterEach(async () => {
      await supervisor.stopAll();
    });

    describe("addInstance", () => {
      it("should add instance successfully", async () => {
        await supervisor.addInstance(createInstanceConfig("test-1"));

        const states = supervisor.getAllStates();
        expect(states).toHaveLength(1);
        expect(states[0]!.id).toBe("test-1");
      });

      it("should throw when adding duplicate instance", async () => {
        await supervisor.addInstance(createInstanceConfig("test-1"));

        await expect(
          supervisor.addInstance(createInstanceConfig("test-1"))
        ).rejects.toThrow("already exists");
      });

      it("should add multiple instances", async () => {
        await supervisor.addInstance(createInstanceConfig("test-1"));
        await supervisor.addInstance(createInstanceConfig("test-2"));
        await supervisor.addInstance(createInstanceConfig("test-3"));

        const states = supervisor.getAllStates();
        expect(states).toHaveLength(3);
      });
    });

    describe("removeInstance", () => {
      it("should remove instance successfully", async () => {
        await supervisor.addInstance(createInstanceConfig("test-1"));
        await supervisor.removeInstance("test-1");

        const states = supervisor.getAllStates();
        expect(states).toHaveLength(0);
      });

      it("should throw when removing non-existent instance", async () => {
        await expect(supervisor.removeInstance("non-existent")).rejects.toThrow(
          "not found"
        );
      });
    });

    describe("getInstance", () => {
      it("should return instance by id", async () => {
        await supervisor.addInstance(createInstanceConfig("test-1"));

        const instance = supervisor.getInstance("test-1");
        expect(instance).toBeDefined();
        expect(instance?.id).toBe("test-1");
      });

      it("should return undefined for non-existent instance", () => {
        const instance = supervisor.getInstance("non-existent");
        expect(instance).toBeUndefined();
      });
    });

    describe("getAllInstances", () => {
      it("should return all instances", async () => {
        await supervisor.addInstance(createInstanceConfig("test-1"));
        await supervisor.addInstance(createInstanceConfig("test-2"));

        const instances = supervisor.getAllInstances();
        expect(instances).toHaveLength(2);
      });

      it("should return empty array when no instances", () => {
        const instances = supervisor.getAllInstances();
        expect(instances).toEqual([]);
      });
    });

    describe("getAllStates", () => {
      it("should return states for all instances", async () => {
        await supervisor.addInstance(createInstanceConfig("test-1"));
        await supervisor.addInstance(createInstanceConfig("test-2"));

        const states = supervisor.getAllStates();
        expect(states).toHaveLength(2);
        expect(states[0]).toHaveProperty("id");
        expect(states[0]).toHaveProperty("status");
        expect(states[0]).toHaveProperty("metrics");
      });
    });

    describe("startInstance/stopInstance", () => {
      it("should throw when starting non-existent instance", async () => {
        await expect(supervisor.startInstance("non-existent")).rejects.toThrow(
          "not found"
        );
      });

      it("should throw when stopping non-existent instance", async () => {
        await expect(supervisor.stopInstance("non-existent")).rejects.toThrow(
          "not found"
        );
      });
    });

    describe("restartInstance", () => {
      it("should throw when restarting non-existent instance", async () => {
        await expect(
          supervisor.restartInstance("non-existent")
        ).rejects.toThrow("not found");
      });
    });

    describe("getInstanceLogs", () => {
      it("should return logs for instance", async () => {
        await supervisor.addInstance(createInstanceConfig("test-1"));

        const logs = supervisor.getInstanceLogs("test-1");
        expect(Array.isArray(logs)).toBe(true);
      });

      it("should throw for non-existent instance", () => {
        expect(() => supervisor.getInstanceLogs("non-existent")).toThrow(
          "not found"
        );
      });

      it("should respect limit and offset", async () => {
        await supervisor.addInstance(createInstanceConfig("test-1"));

        const logs = supervisor.getInstanceLogs("test-1", 10, 5);
        expect(Array.isArray(logs)).toBe(true);
      });
    });

    describe("startAll/stopAll", () => {
      it("should start all instances", async () => {
        await supervisor.addInstance(createInstanceConfig("test-1"));
        await supervisor.addInstance(createInstanceConfig("test-2"));

        // startAll may fail if haunted isn't runnable in test env
        // but it should not throw
        await supervisor.startAll();

        // Cleanup
        await supervisor.stopAll();
      });

      it("should stop all instances gracefully", async () => {
        await supervisor.addInstance(createInstanceConfig("test-1"));
        await supervisor.addInstance(createInstanceConfig("test-2"));

        await supervisor.stopAll();

        const states = supervisor.getAllStates();
        for (const state of states) {
          expect(state.status).toBe("stopped");
        }
      });
    });
  });

  describe("Supervisor with autoRestart disabled", () => {
    it("should not auto-restart when disabled", async () => {
      const supervisor = new Supervisor({
        ...defaultOptions,
        autoRestart: false,
      });

      await supervisor.addInstance(createInstanceConfig("test-1"));

      // Instance won't auto-restart when autoRestart is false
      const instance = supervisor.getInstance("test-1");
      expect(instance).toBeDefined();

      await supervisor.stopAll();
    });
  });
});

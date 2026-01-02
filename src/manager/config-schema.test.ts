import { describe, it, expect } from "vitest";
import { ManagerFullConfigSchema } from "./config-schema.ts";

describe("manager/config-schema", () => {
  describe("ManagerFullConfigSchema", () => {
    it("should parse empty config with defaults", () => {
      const result = ManagerFullConfigSchema.parse({});

      expect(result.version).toBe("1.0");
      expect(result.manager.api.port).toBe(8080);
      expect(result.manager.api.host).toBe("0.0.0.0");
      expect(result.manager.supervisor.auto_restart).toBe(true);
      expect(result.manager.supervisor.max_restarts).toBe(3);
      expect(result.manager.metrics.enabled).toBe(true);
      expect(result.instances).toEqual([]);
    });

    it("should parse full config", () => {
      const config = {
        version: "2.0",
        manager: {
          api: {
            port: 9000,
            host: "127.0.0.1",
            auth: {
              enabled: true,
              api_key: "secret-key",
            },
          },
          logging: {
            level: "debug" as const,
            buffer_size: 2000,
          },
          metrics: {
            enabled: false,
            collect_interval: 60,
          },
          supervisor: {
            auto_restart: false,
            max_restarts: 5,
            restart_window: 10,
            health_check_interval: 120,
          },
        },
        instances: [
          {
            id: "test-instance",
            name: "Test Instance",
            enabled: true,
            working_dir: "/tmp/test",
          },
        ],
      };

      const result = ManagerFullConfigSchema.parse(config);

      expect(result.version).toBe("2.0");
      expect(result.manager.api.port).toBe(9000);
      expect(result.manager.api.host).toBe("127.0.0.1");
      expect(result.manager.api.auth?.enabled).toBe(true);
      expect(result.manager.api.auth?.api_key).toBe("secret-key");
      expect(result.manager.logging.level).toBe("debug");
      expect(result.manager.logging.buffer_size).toBe(2000);
      expect(result.manager.metrics.enabled).toBe(false);
      expect(result.manager.supervisor.auto_restart).toBe(false);
      expect(result.manager.supervisor.max_restarts).toBe(5);
      expect(result.instances).toHaveLength(1);
      expect(result.instances[0].id).toBe("test-instance");
    });

    it("should parse instance with inline config", () => {
      const config = {
        instances: [
          {
            id: "my-repo",
            name: "My Repo",
            config: {
              scope: {
                type: "repo" as const,
                target: "owner/repo",
              },
              github: {
                webhook: {
                  port: 3001,
                },
              },
            },
          },
        ],
      };

      const result = ManagerFullConfigSchema.parse(config);

      expect(result.instances[0].config?.scope.type).toBe("repo");
      expect(result.instances[0].config?.scope.target).toBe("owner/repo");
    });

    it("should parse instance with config_file", () => {
      const config = {
        instances: [
          {
            id: "external",
            name: "External Config",
            config_file: "./instances/external.yaml",
            working_dir: "/path/to/repo",
          },
        ],
      };

      const result = ManagerFullConfigSchema.parse(config);

      expect(result.instances[0].config_file).toBe("./instances/external.yaml");
      expect(result.instances[0].working_dir).toBe("/path/to/repo");
    });

    it("should parse instance with env vars", () => {
      const config = {
        instances: [
          {
            id: "with-env",
            name: "With Env",
            env: {
              GITHUB_TOKEN: "token123",
              LOG_LEVEL: "debug",
            },
          },
        ],
      };

      const result = ManagerFullConfigSchema.parse(config);

      expect(result.instances[0].env?.GITHUB_TOKEN).toBe("token123");
      expect(result.instances[0].env?.LOG_LEVEL).toBe("debug");
    });

    it("should default instance enabled to true", () => {
      const config = {
        instances: [
          {
            id: "default-enabled",
            name: "Default Enabled",
          },
        ],
      };

      const result = ManagerFullConfigSchema.parse(config);

      expect(result.instances[0].enabled).toBe(true);
    });

    it("should reject invalid instance id", () => {
      const config = {
        instances: [
          {
            id: "", // empty id
            name: "Invalid",
          },
        ],
      };

      expect(() => ManagerFullConfigSchema.parse(config)).toThrow();
    });

    it("should reject invalid logging level", () => {
      const config = {
        manager: {
          logging: {
            level: "invalid",
          },
        },
      };

      expect(() => ManagerFullConfigSchema.parse(config)).toThrow();
    });
  });
});

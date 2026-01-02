import { z } from "zod";

// API 認證配置
const ApiAuthSchema = z
  .object({
    enabled: z.boolean().optional(),
    api_key: z.string().optional(),
  })
  .transform((val) => ({
    enabled: val.enabled ?? false,
    api_key: val.api_key,
  }));

// API 配置
const ApiConfigSchema = z
  .object({
    port: z.number().optional(),
    host: z.string().optional(),
    auth: z
      .object({
        enabled: z.boolean().optional(),
        api_key: z.string().optional(),
      })
      .optional(),
  })
  .transform((val) => ({
    port: val.port ?? 8080,
    host: val.host ?? "0.0.0.0",
    auth: val.auth
      ? {
          enabled: val.auth.enabled ?? false,
          api_key: val.auth.api_key,
        }
      : undefined,
  }));

// 日誌配置
const LoggingConfigSchema = z
  .object({
    level: z.enum(["debug", "info", "warn", "error"]).optional(),
    buffer_size: z.number().optional(),
  })
  .transform((val) => ({
    level: val.level ?? "info",
    buffer_size: val.buffer_size ?? 1000,
  }));

// 指標配置
const MetricsConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    collect_interval: z.number().optional(),
  })
  .transform((val) => ({
    enabled: val.enabled ?? true,
    collect_interval: val.collect_interval ?? 30,
  }));

// Supervisor 配置
const SupervisorConfigSchema = z
  .object({
    auto_restart: z.boolean().optional(),
    max_restarts: z.number().optional(),
    restart_window: z.number().optional(),
    health_check_interval: z.number().optional(),
  })
  .transform((val) => ({
    auto_restart: val.auto_restart ?? true,
    max_restarts: val.max_restarts ?? 3,
    restart_window: val.restart_window ?? 5, // minutes
    health_check_interval: val.health_check_interval ?? 60, // seconds
  }));

// Manager 主配置
const ManagerConfigSchema = z
  .object({
    api: z
      .object({
        port: z.number().optional(),
        host: z.string().optional(),
        auth: z
          .object({
            enabled: z.boolean().optional(),
            api_key: z.string().optional(),
          })
          .optional(),
      })
      .optional(),
    logging: z
      .object({
        level: z.enum(["debug", "info", "warn", "error"]).optional(),
        buffer_size: z.number().optional(),
      })
      .optional(),
    metrics: z
      .object({
        enabled: z.boolean().optional(),
        collect_interval: z.number().optional(),
      })
      .optional(),
    supervisor: z
      .object({
        auto_restart: z.boolean().optional(),
        max_restarts: z.number().optional(),
        restart_window: z.number().optional(),
        health_check_interval: z.number().optional(),
      })
      .optional(),
  })
  .transform((val) => ({
    api: {
      port: val.api?.port ?? 8080,
      host: val.api?.host ?? "0.0.0.0",
      auth: val.api?.auth
        ? {
            enabled: val.api.auth.enabled ?? false,
            api_key: val.api.auth.api_key,
          }
        : undefined,
    },
    logging: {
      level: val.logging?.level ?? ("info" as const),
      buffer_size: val.logging?.buffer_size ?? 1000,
    },
    metrics: {
      enabled: val.metrics?.enabled ?? true,
      collect_interval: val.metrics?.collect_interval ?? 30,
    },
    supervisor: {
      auto_restart: val.supervisor?.auto_restart ?? true,
      max_restarts: val.supervisor?.max_restarts ?? 3,
      restart_window: val.supervisor?.restart_window ?? 5,
      health_check_interval: val.supervisor?.health_check_interval ?? 60,
    },
  }));

// Instance 內聯配置（簡化版）
const InstanceInlineConfigSchema = z
  .object({
    scope: z.object({
      type: z.enum(["repo", "organization"]),
      target: z.string(),
    }),
    github: z
      .object({
        webhook: z
          .object({
            enabled: z.boolean().optional(),
            port: z.number().optional(),
            secret: z.string().optional(),
          })
          .optional(),
        polling: z
          .object({
            enabled: z.boolean().optional(),
            interval: z.number().optional(),
          })
          .optional(),
      })
      .optional(),
  })
  .passthrough(); // 允許其他配置項通過

// 單一 Instance 配置
const InstanceConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean().optional().default(true),
  config_file: z.string().optional(),
  config: InstanceInlineConfigSchema.optional(),
  working_dir: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
});

// 完整 Manager 配置
export const ManagerFullConfigSchema = z
  .object({
    version: z.string().optional(),
    manager: z
      .object({
        api: z
          .object({
            port: z.number().optional(),
            host: z.string().optional(),
            auth: z
              .object({
                enabled: z.boolean().optional(),
                api_key: z.string().optional(),
              })
              .optional(),
          })
          .optional(),
        logging: z
          .object({
            level: z.enum(["debug", "info", "warn", "error"]).optional(),
            buffer_size: z.number().optional(),
          })
          .optional(),
        metrics: z
          .object({
            enabled: z.boolean().optional(),
            collect_interval: z.number().optional(),
          })
          .optional(),
        supervisor: z
          .object({
            auto_restart: z.boolean().optional(),
            max_restarts: z.number().optional(),
            restart_window: z.number().optional(),
            health_check_interval: z.number().optional(),
          })
          .optional(),
      })
      .optional(),
    instances: z.array(InstanceConfigSchema).optional(),
  })
  .transform((val) => ({
    version: val.version ?? "1.0",
    manager: {
      api: {
        port: val.manager?.api?.port ?? 8080,
        host: val.manager?.api?.host ?? "0.0.0.0",
        auth: val.manager?.api?.auth
          ? {
              enabled: val.manager.api.auth.enabled ?? false,
              api_key: val.manager.api.auth.api_key,
            }
          : undefined,
      },
      logging: {
        level: val.manager?.logging?.level ?? ("info" as const),
        buffer_size: val.manager?.logging?.buffer_size ?? 1000,
      },
      metrics: {
        enabled: val.manager?.metrics?.enabled ?? true,
        collect_interval: val.manager?.metrics?.collect_interval ?? 30,
      },
      supervisor: {
        auto_restart: val.manager?.supervisor?.auto_restart ?? true,
        max_restarts: val.manager?.supervisor?.max_restarts ?? 3,
        restart_window: val.manager?.supervisor?.restart_window ?? 5,
        health_check_interval: val.manager?.supervisor?.health_check_interval ?? 60,
      },
    },
    instances: val.instances ?? [],
  }));

// 類型導出
export type ApiAuth = z.infer<typeof ApiAuthSchema>;
export type ApiConfig = z.infer<typeof ApiConfigSchema>;
export type LoggingConfig = z.infer<typeof LoggingConfigSchema>;
export type MetricsConfig = z.infer<typeof MetricsConfigSchema>;
export type SupervisorConfig = z.infer<typeof SupervisorConfigSchema>;
export type ManagerConfig = z.infer<typeof ManagerConfigSchema>;
export type InstanceInlineConfig = z.infer<typeof InstanceInlineConfigSchema>;
export type InstanceConfig = z.infer<typeof InstanceConfigSchema>;
export type ManagerFullConfig = z.infer<typeof ManagerFullConfigSchema>;

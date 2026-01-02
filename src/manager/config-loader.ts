import { access } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { ManagerFullConfigSchema, type ManagerFullConfig } from "@/manager/config-schema.ts";
import { createLogger } from "@/utils/logger.ts";

const logger = createLogger("manager-config");

const CONFIG_FILENAMES = ["manager.yaml", "manager.yml", ".manager.yaml", ".manager.yml"];

function resolveEnvVars(obj: unknown): unknown {
  if (typeof obj === "string") {
    return obj.replace(/\$\{([^}]+)\}/g, (_, key) => process.env[key] ?? "");
  }
  if (Array.isArray(obj)) {
    return obj.map(resolveEnvVars);
  }
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = resolveEnvVars(value);
    }
    return result;
  }
  return obj;
}

async function findManagerConfigFile(basePath: string): Promise<string | null> {
  for (const filename of CONFIG_FILENAMES) {
    const filepath = join(basePath, filename);
    try {
      await access(filepath);
      return filepath;
    } catch {
      continue;
    }
  }
  return null;
}

export async function loadManagerConfig(
  basePath: string = process.cwd()
): Promise<ManagerFullConfig> {
  const configPath = await findManagerConfigFile(basePath);

  if (!configPath) {
    throw new Error(
      `Manager configuration file not found. Please create one of: ${CONFIG_FILENAMES.join(", ")}`
    );
  }

  logger.info({ path: configPath }, "Loading manager configuration");

  const file = Bun.file(configPath);
  const content = await file.text();
  const rawConfig = parse(content);
  const resolvedConfig = resolveEnvVars(rawConfig);

  const result = ManagerFullConfigSchema.safeParse(resolvedConfig);

  if (!result.success) {
    logger.error({ error: result.error }, "Invalid manager configuration");
    throw new Error(`Invalid manager configuration: ${result.error.toString()}`);
  }

  logger.info(
    { instanceCount: result.data.instances.length },
    "Manager configuration loaded successfully"
  );

  return result.data;
}

export function validateManagerConfig(config: unknown): ManagerFullConfig {
  return ManagerFullConfigSchema.parse(config);
}

import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { ConfigSchema, type Config } from "@/config/schema.ts";
import { createLogger } from "@/utils/logger.ts";

const logger = createLogger("config");

const CONFIG_FILENAMES = ["haunted.yaml", "haunted.yml", ".haunted.yaml", ".haunted.yml"];

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

async function findConfigFile(basePath: string): Promise<string | null> {
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

export async function loadConfig(basePath: string = process.cwd()): Promise<Config> {
  // 支援環境變數覆蓋配置路徑
  const envConfigPath = process.env.HAUNTED_CONFIG_PATH;
  const configPath = envConfigPath ?? (await findConfigFile(basePath));

  if (!configPath) {
    throw new Error(
      `Configuration file not found. Please create one of: ${CONFIG_FILENAMES.join(", ")}`
    );
  }

  logger.info({ path: configPath }, "Loading configuration");

  const content = await readFile(configPath, "utf-8");
  const rawConfig = parse(content);
  const resolvedConfig = resolveEnvVars(rawConfig);

  const result = ConfigSchema.safeParse(resolvedConfig);

  if (!result.success) {
    logger.error({ error: result.error }, "Invalid configuration");
    throw new Error(`Invalid configuration: ${result.error.toString()}`);
  }

  logger.info({ scope: result.data.scope }, "Configuration loaded successfully");
  return result.data;
}

export function validateConfig(config: unknown): Config {
  return ConfigSchema.parse(config);
}

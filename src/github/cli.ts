import { spawn } from "node:child_process";
import { createLogger } from "@/utils/logger.ts";

const logger = createLogger("gh-cli");

export interface GhResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface GhOptions {
  cwd?: string;
  env?: Record<string, string>;
}

export async function gh(args: string[], options: GhOptions = {}): Promise<GhResult> {
  const { cwd, env } = options;

  logger.debug({ args, cwd }, "Executing gh command");

  return new Promise((resolve, reject) => {
    const process = spawn("gh", args, {
      cwd,
      env: { ...Bun.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    process.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    process.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    process.on("error", (error) => {
      logger.error({ error, args }, "Failed to execute gh command");
      reject(error);
    });

    process.on("close", (code) => {
      const result: GhResult = {
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code ?? 0,
      };

      if (code !== 0) {
        logger.warn({ args, exitCode: code, stderr: result.stderr }, "gh command failed");
      } else {
        logger.debug({ args, stdout: result.stdout.slice(0, 200) }, "gh command succeeded");
      }

      resolve(result);
    });
  });
}

export async function ghJson<T>(args: string[], options: GhOptions = {}): Promise<T> {
  const result = await gh([...args, "--json"], options);

  if (result.exitCode !== 0) {
    throw new Error(`gh command failed: ${result.stderr}`);
  }

  return JSON.parse(result.stdout) as T;
}

export async function checkGhAuth(): Promise<boolean> {
  const result = await gh(["auth", "status"]);
  return result.exitCode === 0;
}

export async function getGhUser(): Promise<string | null> {
  const result = await gh(["api", "user", "--jq", ".login"]);
  if (result.exitCode !== 0) {
    return null;
  }
  return result.stdout;
}

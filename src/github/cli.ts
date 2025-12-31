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
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Base delay in milliseconds for exponential backoff (default: 1000) */
  baseDelayMs?: number;
}

/** Default retry configuration (can be overridden via environment variables) */
const DEFAULT_MAX_RETRIES = parseInt(process.env.GH_MAX_RETRIES || "3", 10);
const DEFAULT_BASE_DELAY_MS = parseInt(process.env.GH_BASE_DELAY_MS || "1000", 10);

/**
 * Determines if an error is retryable based on stderr content.
 * Retryable errors include:
 * - 5xx server errors
 * - HTTP 429 (Rate Limit) errors
 * - Network/connection errors
 * - Timeout errors
 */
export function isRetryableError(stderr: string): boolean {
  const lowerStderr = stderr.toLowerCase();

  // Check for HTTP 429 Rate Limit errors
  const rateLimitPattern = /\b429\b|rate limit|too many requests/i;
  if (rateLimitPattern.test(stderr)) {
    return true;
  }

  // Check for 5xx HTTP errors
  const http5xxPattern = /\b5\d{2}\b|internal server error|bad gateway|service unavailable|gateway timeout/i;
  if (http5xxPattern.test(stderr)) {
    return true;
  }

  // Check for network/connection errors
  const networkErrorPatterns = [
    "connection refused",
    "connection reset",
    "network unreachable",
    "host unreachable",
    "connection timed out",
    "timeout",
    "econnrefused",
    "econnreset",
    "etimedout",
    "enetunreach",
    "ehostunreach",
    "socket hang up",
    "dns lookup failed",
    "getaddrinfo",
    "unable to connect",
    "could not resolve",
  ];

  return networkErrorPatterns.some((pattern) => lowerStderr.includes(pattern));
}

/**
 * Sleep for a specified duration.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay with jitter.
 * Base delay = baseDelay * 2^attempt (e.g., 1s, 2s, 4s for attempts 0, 1, 2)
 * Jitter is applied as: delay * (0.5 + Math.random()) to avoid thundering herd
 */
export function calculateBackoffDelay(attempt: number, baseDelayMs: number, withJitter: boolean = true): number {
  const baseDelay = baseDelayMs * Math.pow(2, attempt);
  if (withJitter) {
    // Apply jitter: multiply by random factor between 0.5 and 1.5
    return Math.floor(baseDelay * (0.5 + Math.random()));
  }
  return baseDelay;
}

/**
 * Execute a single gh command (internal, no retry).
 */
async function executeGhCommand(args: string[], cwd?: string, env?: Record<string, string>): Promise<GhResult> {
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
      reject(error);
    });

    process.on("close", (code) => {
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code ?? 0,
      });
    });
  });
}

export async function gh(args: string[], options: GhOptions = {}): Promise<GhResult> {
  const {
    cwd,
    env,
    maxRetries = DEFAULT_MAX_RETRIES,
    baseDelayMs = DEFAULT_BASE_DELAY_MS
  } = options;

  logger.debug({ args, cwd }, "Executing gh command");

  let lastError: Error | null = null;
  let lastResult: GhResult | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await executeGhCommand(args, cwd, env);

      // Success case
      if (result.exitCode === 0) {
        logger.debug({ args, stdout: result.stdout.slice(0, 200) }, "gh command succeeded");
        return result;
      }

      // Failed but check if retryable
      if (attempt < maxRetries && isRetryableError(result.stderr)) {
        const delay = calculateBackoffDelay(attempt, baseDelayMs);
        logger.warn(
          { args, exitCode: result.exitCode, stderr: result.stderr, attempt: attempt + 1, maxRetries, delayMs: delay },
          "gh command failed with retryable error, will retry"
        );
        await sleep(delay);
        continue;
      }

      // Non-retryable error or exhausted retries
      logger.warn({ args, exitCode: result.exitCode, stderr: result.stderr }, "gh command failed");
      return result;

    } catch (error) {
      lastError = error as Error;

      // Check if the spawn error itself is retryable (e.g., network issues)
      const errorMessage = lastError.message || "";
      if (attempt < maxRetries && isRetryableError(errorMessage)) {
        const delay = calculateBackoffDelay(attempt, baseDelayMs);
        logger.warn(
          { error: lastError, args, attempt: attempt + 1, maxRetries, delayMs: delay },
          "gh command execution error, will retry"
        );
        await sleep(delay);
        continue;
      }

      // Non-retryable error or exhausted retries
      logger.error({ error: lastError, args }, "Failed to execute gh command");
      throw lastError;
    }
  }

  // This should not be reached, but defensive check just in case
  if (lastError) {
    throw lastError;
  }

  // Return last result if we have one, otherwise throw an error
  if (lastResult) {
    return lastResult;
  }

  // This should never happen, but provide a clear error if it does
  throw new Error(`gh command failed after ${maxRetries} retries: unexpected state with no result or error`);
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

import { vi } from "vitest";
import type { GhResult } from "@/github/cli.ts";

export type MockGhResponse = {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
};

export const mockGhResponses: Map<string, MockGhResponse> = new Map();

export function mockGh(argsPattern: string, response: MockGhResponse): void {
  mockGhResponses.set(argsPattern, response);
}

export function mockGhJson<T>(argsPattern: string, data: T): void {
  mockGhResponses.set(argsPattern, {
    stdout: JSON.stringify(data),
    exitCode: 0,
  });
}

export function mockGhError(argsPattern: string, errorMessage: string): void {
  mockGhResponses.set(argsPattern, {
    stderr: errorMessage,
    exitCode: 1,
  });
}

export function clearGhMocks(): void {
  mockGhResponses.clear();
}

export function findMockResponse(args: string[]): MockGhResponse | undefined {
  const argsStr = args.join(" ");

  // First try exact match
  if (mockGhResponses.has(argsStr)) {
    return mockGhResponses.get(argsStr);
  }

  // Then try pattern match (check if argsStr starts with pattern)
  for (const [pattern, response] of mockGhResponses) {
    if (argsStr.startsWith(pattern) || argsStr.includes(pattern)) {
      return response;
    }
  }

  return undefined;
}

export const createMockGh = () => {
  return vi.fn(async (args: string[]): Promise<GhResult> => {
    const response = findMockResponse(args);

    if (!response) {
      return {
        stdout: "",
        stderr: `Mock not found for: ${args.join(" ")}`,
        exitCode: 1,
      };
    }

    return {
      stdout: response.stdout ?? "",
      stderr: response.stderr ?? "",
      exitCode: response.exitCode ?? 0,
    };
  });
};

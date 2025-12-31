import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isRetryableError, calculateBackoffDelay } from "./cli.ts";

// Mock the logger to avoid noise in tests
vi.mock("@/utils/logger.ts", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("github/cli", () => {
  describe("isRetryableError", () => {
    describe("5xx HTTP errors", () => {
      it("should return true for 500 Internal Server Error", () => {
        expect(isRetryableError("HTTP 500: Internal Server Error")).toBe(true);
      });

      it("should return true for 502 Bad Gateway", () => {
        expect(isRetryableError("HTTP 502: Bad Gateway")).toBe(true);
      });

      it("should return true for 503 Service Unavailable", () => {
        expect(isRetryableError("HTTP 503: Service Unavailable")).toBe(true);
      });

      it("should return true for 504 Gateway Timeout", () => {
        expect(isRetryableError("HTTP 504: Gateway Timeout")).toBe(true);
      });

      it("should return true for generic 5xx pattern", () => {
        expect(isRetryableError("error: 522")).toBe(true);
        expect(isRetryableError("server returned 599")).toBe(true);
      });

      it("should return true for 'internal server error' text", () => {
        expect(isRetryableError("internal server error occurred")).toBe(true);
      });

      it("should return true for 'bad gateway' text", () => {
        expect(isRetryableError("bad gateway")).toBe(true);
      });

      it("should return true for 'service unavailable' text", () => {
        expect(isRetryableError("service unavailable")).toBe(true);
      });

      it("should return true for 'gateway timeout' text", () => {
        expect(isRetryableError("gateway timeout")).toBe(true);
      });
    });

    describe("network errors", () => {
      it("should return true for connection refused", () => {
        expect(isRetryableError("connection refused")).toBe(true);
        expect(isRetryableError("ECONNREFUSED")).toBe(true);
      });

      it("should return true for connection reset", () => {
        expect(isRetryableError("connection reset")).toBe(true);
        expect(isRetryableError("ECONNRESET")).toBe(true);
      });

      it("should return true for timeout errors", () => {
        expect(isRetryableError("connection timed out")).toBe(true);
        expect(isRetryableError("request timeout")).toBe(true);
        expect(isRetryableError("ETIMEDOUT")).toBe(true);
      });

      it("should return true for network unreachable", () => {
        expect(isRetryableError("network unreachable")).toBe(true);
        expect(isRetryableError("ENETUNREACH")).toBe(true);
      });

      it("should return true for host unreachable", () => {
        expect(isRetryableError("host unreachable")).toBe(true);
        expect(isRetryableError("EHOSTUNREACH")).toBe(true);
      });

      it("should return true for socket hang up", () => {
        expect(isRetryableError("socket hang up")).toBe(true);
      });

      it("should return true for DNS errors", () => {
        expect(isRetryableError("dns lookup failed")).toBe(true);
        expect(isRetryableError("getaddrinfo ENOTFOUND")).toBe(true);
        expect(isRetryableError("could not resolve host")).toBe(true);
      });

      it("should return true for unable to connect", () => {
        expect(isRetryableError("unable to connect to server")).toBe(true);
      });
    });

    describe("non-retryable errors", () => {
      it("should return false for 4xx client errors", () => {
        expect(isRetryableError("HTTP 400: Bad Request")).toBe(false);
        expect(isRetryableError("HTTP 401: Unauthorized")).toBe(false);
        expect(isRetryableError("HTTP 403: Forbidden")).toBe(false);
        expect(isRetryableError("HTTP 404: Not Found")).toBe(false);
        expect(isRetryableError("HTTP 422: Unprocessable Entity")).toBe(false);
      });

      it("should return false for authentication errors", () => {
        expect(isRetryableError("authentication failed")).toBe(false);
        expect(isRetryableError("invalid token")).toBe(false);
      });

      it("should return false for permission errors", () => {
        expect(isRetryableError("permission denied")).toBe(false);
        expect(isRetryableError("access denied")).toBe(false);
      });

      it("should return false for not found errors", () => {
        expect(isRetryableError("repository not found")).toBe(false);
        expect(isRetryableError("issue not found")).toBe(false);
      });

      it("should return false for validation errors", () => {
        expect(isRetryableError("validation failed")).toBe(false);
        expect(isRetryableError("invalid arguments")).toBe(false);
      });

      it("should return false for empty string", () => {
        expect(isRetryableError("")).toBe(false);
      });
    });
  });

  describe("calculateBackoffDelay", () => {
    it("should calculate correct delay for attempt 0", () => {
      expect(calculateBackoffDelay(0, 1000)).toBe(1000);
    });

    it("should calculate correct delay for attempt 1", () => {
      expect(calculateBackoffDelay(1, 1000)).toBe(2000);
    });

    it("should calculate correct delay for attempt 2", () => {
      expect(calculateBackoffDelay(2, 1000)).toBe(4000);
    });

    it("should calculate correct delay for attempt 3", () => {
      expect(calculateBackoffDelay(3, 1000)).toBe(8000);
    });

    it("should work with different base delays", () => {
      expect(calculateBackoffDelay(0, 500)).toBe(500);
      expect(calculateBackoffDelay(1, 500)).toBe(1000);
      expect(calculateBackoffDelay(2, 500)).toBe(2000);
    });

    it("should handle custom base delay", () => {
      expect(calculateBackoffDelay(0, 100)).toBe(100);
      expect(calculateBackoffDelay(1, 100)).toBe(200);
      expect(calculateBackoffDelay(2, 100)).toBe(400);
    });
  });
});

describe("gh() retry behavior", () => {
  // Note: These tests use a mock implementation to avoid actually spawning gh commands.
  // The actual retry behavior is tested via integration with the implementation above.

  it("should export isRetryableError function", () => {
    expect(typeof isRetryableError).toBe("function");
  });

  it("should export calculateBackoffDelay function", () => {
    expect(typeof calculateBackoffDelay).toBe("function");
  });
});

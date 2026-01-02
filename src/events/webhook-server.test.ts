import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { createWebhookServer, verifySignature } from "./webhook-server.ts";
import type { Config } from "@/config/schema.ts";

type WebhookResponse = { error?: string; status?: string; timestamp?: string };

// Mock logger
vi.mock("@/utils/logger.ts", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Helper to generate valid signature
function generateSignature(payload: string, secret: string): string {
  const hmac = createHmac("sha256", secret);
  hmac.update(payload);
  return `sha256=${hmac.digest("hex")}`;
}

describe("webhook-server", () => {
  const mockHandler = vi.fn();

  const createConfig = (secret?: string): Config => ({
    version: "1.0",
    scope: { type: "repo", target: "test/repo" },
    github: {
      webhook: { enabled: true, port: 3000, secret },
      polling: { enabled: false, interval: 60 },
    },
    agents: {
      house_master: { enabled: true, auto_assign: true, auto_review: true },
      claude_code: { enabled: true, branch_prefix: "haunted/", auto_test: true },
    },
    pull_requests: {
      auto_merge: { enabled: false, require_approval: true, require_ci_pass: true },
      rules: [],
    },
    project: { enabled: false, number: undefined, columns: [], driven: false },
    labels: {
      human_only: "human-only",
      skip: "haunted-skip",
      auto_merge: "auto-merge",
      needs_review: "needs-review",
      issue_types: {},
      complexity: {},
      priority: {},
      auto_label: true,
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockHandler.mockResolvedValue(undefined);
  });

  describe("verifySignature", () => {
    const secret = "test-secret-key";
    const payload = '{"action":"opened"}';

    it("should return true for valid signature", () => {
      const signature = generateSignature(payload, secret);
      expect(verifySignature(payload, signature, secret)).toBe(true);
    });

    it("should return false for invalid signature", () => {
      const invalidSignature = "sha256=invalid0000000000000000000000000000000000000000000000000000000000";
      expect(verifySignature(payload, invalidSignature, secret)).toBe(false);
    });

    it("should return false for wrong secret", () => {
      const signature = generateSignature(payload, secret);
      expect(verifySignature(payload, signature, "wrong-secret")).toBe(false);
    });

    it("should return false for tampered payload", () => {
      const signature = generateSignature(payload, secret);
      const tamperedPayload = '{"action":"closed"}';
      expect(verifySignature(tamperedPayload, signature, secret)).toBe(false);
    });

    it("should return false for signature with wrong length", () => {
      const shortSignature = "sha256=abc123";
      expect(verifySignature(payload, shortSignature, secret)).toBe(false);
    });

    it("should use constant-time comparison (same length signatures)", () => {
      // This test verifies the constant-time comparison doesn't short-circuit
      // Both signatures have the same length but different content
      const validSig = generateSignature(payload, secret);
      const sameLengthInvalidSig = validSig.replace(/[0-9a-f]/g, "0");

      // Should still return false, verifying comparison completes
      expect(verifySignature(payload, sameLengthInvalidSig, secret)).toBe(false);
    });
  });

  describe("webhook endpoint security", () => {
    describe("when secret is configured", () => {
      const secret = "webhook-secret";
      const payload = JSON.stringify({ action: "opened", repository: { full_name: "test/repo" } });

      it("should reject requests without signature header (401)", async () => {
        const config = createConfig(secret);
        const { app } = createWebhookServer(config, mockHandler);

        const response = await app.request("/webhook", {
          method: "POST",
          headers: {
            "x-github-event": "issues",
            "x-github-delivery": "test-delivery-id",
            "content-type": "application/json",
          },
          body: payload,
        });

        expect(response.status).toBe(401);
        const body = (await response.json()) as WebhookResponse;
        expect(body.error).toBe("Missing signature");
        expect(mockHandler).not.toHaveBeenCalled();
      });

      it("should reject requests with invalid signature (401)", async () => {
        const config = createConfig(secret);
        const { app } = createWebhookServer(config, mockHandler);

        const response = await app.request("/webhook", {
          method: "POST",
          headers: {
            "x-github-event": "issues",
            "x-github-delivery": "test-delivery-id",
            "x-hub-signature-256": "sha256=invalid0000000000000000000000000000000000000000000000000000000000",
            "content-type": "application/json",
          },
          body: payload,
        });

        expect(response.status).toBe(401);
        const body = (await response.json()) as WebhookResponse;
        expect(body.error).toBe("Invalid signature");
        expect(mockHandler).not.toHaveBeenCalled();
      });

      it("should accept requests with valid signature", async () => {
        const config = createConfig(secret);
        const { app } = createWebhookServer(config, mockHandler);
        const validSignature = generateSignature(payload, secret);

        const response = await app.request("/webhook", {
          method: "POST",
          headers: {
            "x-github-event": "issues",
            "x-github-delivery": "test-delivery-id",
            "x-hub-signature-256": validSignature,
            "content-type": "application/json",
          },
          body: payload,
        });

        expect(response.status).toBe(200);
        const body = (await response.json()) as WebhookResponse;
        expect(body.status).toBe("accepted");
        expect(mockHandler).toHaveBeenCalledTimes(1);
      });

      it("should reject forged payloads even with signature header", async () => {
        const config = createConfig(secret);
        const { app } = createWebhookServer(config, mockHandler);

        // Attacker signs their own payload with a guessed/leaked secret
        const maliciousPayload = JSON.stringify({ action: "opened", malicious: true });
        // But they don't know the real secret, so signature won't match
        const wrongSignature = generateSignature(maliciousPayload, "wrong-secret");

        const response = await app.request("/webhook", {
          method: "POST",
          headers: {
            "x-github-event": "issues",
            "x-github-delivery": "test-delivery-id",
            "x-hub-signature-256": wrongSignature,
            "content-type": "application/json",
          },
          body: maliciousPayload,
        });

        expect(response.status).toBe(401);
        expect(mockHandler).not.toHaveBeenCalled();
      });
    });

    describe("when no secret is configured", () => {
      it("should accept requests without signature", async () => {
        const config = createConfig(undefined); // No secret
        const { app } = createWebhookServer(config, mockHandler);
        const payload = JSON.stringify({ action: "opened" });

        const response = await app.request("/webhook", {
          method: "POST",
          headers: {
            "x-github-event": "issues",
            "x-github-delivery": "test-delivery-id",
            "content-type": "application/json",
          },
          body: payload,
        });

        expect(response.status).toBe(200);
        expect(mockHandler).toHaveBeenCalledTimes(1);
      });
    });

    describe("general validation", () => {
      it("should reject requests without event type header (400)", async () => {
        const config = createConfig();
        const { app } = createWebhookServer(config, mockHandler);

        const response = await app.request("/webhook", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: "{}",
        });

        expect(response.status).toBe(400);
        const body = (await response.json()) as WebhookResponse;
        expect(body.error).toBe("Missing event type");
      });

      it("should reject invalid JSON payload (400)", async () => {
        const config = createConfig();
        const { app } = createWebhookServer(config, mockHandler);

        const response = await app.request("/webhook", {
          method: "POST",
          headers: {
            "x-github-event": "issues",
            "content-type": "application/json",
          },
          body: "not valid json",
        });

        expect(response.status).toBe(400);
        const body = (await response.json()) as WebhookResponse;
        expect(body.error).toBe("Invalid JSON");
      });

      it("should return 500 if handler throws", async () => {
        const config = createConfig();
        const { app } = createWebhookServer(config, mockHandler);
        mockHandler.mockRejectedValueOnce(new Error("Handler error"));

        const response = await app.request("/webhook", {
          method: "POST",
          headers: {
            "x-github-event": "issues",
            "content-type": "application/json",
          },
          body: JSON.stringify({ action: "opened" }),
        });

        expect(response.status).toBe(500);
        const body = (await response.json()) as WebhookResponse;
        expect(body.error).toBe("Processing failed");
      });
    });
  });

  describe("health endpoint", () => {
    it("should return ok status", async () => {
      const config = createConfig();
      const { app } = createWebhookServer(config, mockHandler);

      const response = await app.request("/health");

      expect(response.status).toBe(200);
      const body = (await response.json()) as WebhookResponse;
      expect(body.status).toBe("ok");
      expect(body.timestamp).toBeDefined();
    });
  });
});

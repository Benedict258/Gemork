import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  generateApiKey,
  loadOrGenerateApiKey,
  createAuthMiddleware,
  verifyWsApiKey,
} from "../../src/auth/persistent-auth.js";

describe("auth/persistent-auth", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "gemork-auth-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("generateApiKey", () => {
    it("generates a 32-char hex string", () => {
      const key = generateApiKey();
      expect(key).toMatch(/^[0-9a-f]{32}$/);
    });

    it("generates unique keys", () => {
      const key1 = generateApiKey();
      const key2 = generateApiKey();
      expect(key1).not.toBe(key2);
    });
  });

  describe("loadOrGenerateApiKey", () => {
    it("generates and saves a new key when no file exists", () => {
      const key = loadOrGenerateApiKey(tempDir);
      expect(key).toMatch(/^[0-9a-f]{32}$/);

      const authFile = join(tempDir, ".gemork", "auth.json");
      expect(existsSync(authFile)).toBe(true);
    });

    it("loads an existing key on subsequent calls", () => {
      const key1 = loadOrGenerateApiKey(tempDir);
      const key2 = loadOrGenerateApiKey(tempDir);
      expect(key1).toBe(key2);
    });

    it("creates .gemork directory if it doesn't exist", async () => {
      const subdir = join(tempDir, "nested", "project");
      await mkdir(subdir, { recursive: true });
      const key = loadOrGenerateApiKey(subdir);
      expect(existsSync(join(subdir, ".gemork", "auth.json"))).toBe(true);
    });

    it("regenerates key if auth.json is corrupted", async () => {
      const gemorkDir = join(tempDir, ".gemork");
      await mkdir(gemorkDir, { recursive: true });
      await writeFile(join(gemorkDir, "auth.json"), "not-json", "utf-8");

      const key = loadOrGenerateApiKey(tempDir);
      expect(key).toMatch(/^[0-9a-f]{32}$/);
    });
  });

  describe("createAuthMiddleware", () => {
    function mockReq(path: string, headers: Record<string, string> = {}, query: Record<string, string> = {}) {
      return { path, headers, query };
    }

    function mockRes() {
      const res: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };
      return res;
    }

    it("allows requests with correct X-API-Key header", () => {
      const middleware = createAuthMiddleware("test-key-123");
      const req = mockReq("/goals", { "x-api-key": "test-key-123" });
      const res = mockRes();
      const next = vi.fn();

      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it("allows requests with correct ?key= query param", () => {
      const middleware = createAuthMiddleware("test-key-123");
      const req = mockReq("/goals", {}, { key: "test-key-123" });
      const res = mockRes();
      const next = vi.fn();

      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("rejects requests without API key", () => {
      const middleware = createAuthMiddleware("test-key-123");
      const req = mockReq("/goals");
      const res = mockRes();
      const next = vi.fn();

      middleware(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining("Unauthorized") })
      );
    });

    it("rejects requests with wrong API key", () => {
      const middleware = createAuthMiddleware("test-key-123");
      const req = mockReq("/goals", { "x-api-key": "wrong-key" });
      const res = mockRes();
      const next = vi.fn();

      middleware(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it("skips auth for /health endpoint", () => {
      const middleware = createAuthMiddleware("test-key-123");
      const req = mockReq("/health");
      const res = mockRes();
      const next = vi.fn();

      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe("verifyWsApiKey", () => {
    it("returns true for valid key in URL", () => {
      expect(verifyWsApiKey("ws://localhost:8081?key=abc123", "abc123")).toBe(true);
    });

    it("returns false for missing key", () => {
      expect(verifyWsApiKey("ws://localhost:8081", "abc123")).toBe(false);
    });

    it("returns false for wrong key", () => {
      expect(verifyWsApiKey("ws://localhost:8081?key=wrong", "abc123")).toBe(false);
    });

    it("returns false for malformed URL", () => {
      expect(verifyWsApiKey("not-a-url", "abc123")).toBe(false);
    });
  });
});

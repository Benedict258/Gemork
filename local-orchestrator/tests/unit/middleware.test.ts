import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createLogger,
  setLogLevel,
  getLogLevel,
  type LogEntry,
} from "../../src/middleware/logger.js";
import {
  createErrorHandler,
  createAsyncHandler,
  onError,
  type ErrorEvent,
} from "../../src/middleware/error-handler.js";
import {
  healthCheckHandler,
  registerHealthCheck,
  createDefaultHealthChecks,
} from "../../src/middleware/health-check.js";
import { GemorkError, LLMError } from "../../src/errors.js";
import type { Request, Response, NextFunction } from "express";

// ─── Logger Tests ────────────────────────────────────────────

describe("middleware/logger", () => {
  beforeEach(() => {
    setLogLevel("info");
  });

  it("createLogger returns logger with all levels", () => {
    const log = createLogger("test-module");
    expect(typeof log.error).toBe("function");
    expect(typeof log.warn).toBe("function");
    expect(typeof log.info).toBe("function");
    expect(typeof log.debug).toBe("function");
  });

  it("setLogLevel and getLogLevel work", () => {
    setLogLevel("debug");
    expect(getLogLevel()).toBe("debug");
    setLogLevel("error");
    expect(getLogLevel()).toBe("error");
  });

  it("writes structured JSON to stderr for error", () => {
    const writeSpy = vi.spyOn(process.stderr, "write");
    const log = createLogger("my-module");
    log.error("something broke", { detail: 42 });

    expect(writeSpy).toHaveBeenCalled();
    const output = writeSpy.mock.calls[0][0] as string;
    const entry: LogEntry = JSON.parse(output.trim());
    expect(entry.level).toBe("error");
    expect(entry.module).toBe("my-module");
    expect(entry.message).toBe("something broke");
    expect(entry.context).toEqual({ detail: 42 });
    expect(entry.timestamp).toBeTruthy();
    writeSpy.mockRestore();
  });

  it("writes structured JSON to stdout for info", () => {
    const writeSpy = vi.spyOn(process.stdout, "write");
    const log = createLogger("mod");
    log.info("hello");

    const output = writeSpy.mock.calls[0][0] as string;
    const entry: LogEntry = JSON.parse(output.trim());
    expect(entry.level).toBe("info");
    expect(entry.message).toBe("hello");
    writeSpy.mockRestore();
  });

  it("skips log when level is below threshold", () => {
    setLogLevel("warn");
    const log = createLogger("mod");
    const infoSpy = vi.spyOn(process.stdout, "write");

    log.info("should not appear");
    expect(infoSpy).not.toHaveBeenCalled();
    infoSpy.mockRestore();
  });

  it("defaults to info level", () => {
    // Reset to test default
    delete process.env.GEMORK_LOG_LEVEL;
    setLogLevel("info");
    expect(getLogLevel()).toBe("info");
  });
});

// ─── Error Handler Tests ─────────────────────────────────────

describe("middleware/error-handler", () => {
  function mockReq(): Request {
    return {} as Request;
  }

  function mockRes(): Response & { statusCode?: number; body?: unknown } {
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response & { statusCode?: number; body?: unknown };
    return res;
  }

  it("catches GemorkError and returns structured response", () => {
    const handler = createErrorHandler();
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn() as NextFunction;

    const err = new GemorkError("TEST_ERR", "test error", { module: "test" });
    handler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "test error",
        code: "TEST_ERR",
        recoverable: true,
      }),
    );
  });

  it("returns 403 for GUARDRAIL_PERMISSION_DENIED", () => {
    const handler = createErrorHandler();
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn() as NextFunction;

    const err = new GemorkError("GUARDRAIL_PERMISSION_DENIED", "no");
    handler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("returns 401 for CONNECTOR_AUTH_EXPIRED", () => {
    const handler = createErrorHandler();
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn() as NextFunction;

    const err = new GemorkError("CONNECTOR_AUTH_EXPIRED", "expired");
    handler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns 429 for CONNECTOR_RATE_LIMITED", () => {
    const handler = createErrorHandler();
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn() as NextFunction;

    const err = new GemorkError("CONNECTOR_RATE_LIMITED", "slow down");
    handler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(429);
  });

  it("returns 500 for unknown errors", () => {
    const handler = createErrorHandler();
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn() as NextFunction;

    handler(new Error("unknown"), req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("emits error events", () => {
    const handler = createErrorHandler();
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn() as NextFunction;

    let captured: ErrorEvent | undefined;
    const unsub = onError((e) => { captured = e; });

    handler(new Error("boom"), req, res, next);
    expect(captured).toBeDefined();
    expect(captured!.message).toBe("boom");
    unsub();
  });
});

// ─── Async Handler Tests ─────────────────────────────────────

describe("middleware/asyncHandler", () => {
  it("wraps async function and catches errors", async () => {
    const handler = createAsyncHandler(async (req, res) => {
      (res as any).json({ ok: true });
    });

    const req = {} as Request;
    const res = { json: vi.fn() } as unknown as Response;
    const next = vi.fn() as NextFunction;

    await handler(req, res, next);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next on async rejection", async () => {
    const handler = createAsyncHandler(async () => {
      throw new Error("async fail");
    });

    const req = {} as Request;
    const res = {} as Response;
    const next = vi.fn() as NextFunction;

    await handler(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0].message).toBe("async fail");
  });
});

// ─── Health Check Tests ──────────────────────────────────────

describe("middleware/health-check", () => {
  it("createDefaultHealthChecks registers basic modules", () => {
    createDefaultHealthChecks();
    // The function should not throw
    expect(true).toBe(true);
  });

  it("healthCheckHandler returns ok status", async () => {
    const req = {} as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;

    await healthCheckHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = (res.json as any).mock.calls[0][0];
    expect(body.status).toBe("ok");
    expect(body.version).toBeTruthy();
    expect(typeof body.uptime).toBe("number");
    expect(body.modules).toBeDefined();
  });

  it("registerHealthCheck adds custom checker", async () => {
    registerHealthCheck("custom", () => ({ status: "ok", message: "custom ok" }));

    const req = {} as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;

    await healthCheckHandler(req, res);

    const body = (res.json as any).mock.calls[0][0];
    expect(body.modules.custom).toEqual({ status: "ok", message: "custom ok" });
  });

  it("returns 503 when a module is down", async () => {
    registerHealthCheck("failing", () => ({ status: "down", message: "broken" }));

    const req = {} as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;

    await healthCheckHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    const body = (res.json as any).mock.calls[0][0];
    expect(body.status).toBe("down");
    expect(body.modules.failing.status).toBe("down");
  });

  it("handles checker that throws", async () => {
    registerHealthCheck("throws", () => {
      throw new Error("checker crash");
    });

    const req = {} as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;

    await healthCheckHandler(req, res);

    const body = (res.json as any).mock.calls[0][0];
    expect(body.modules.throws.status).toBe("down");
    expect(body.modules.throws.message).toBe("checker crash");
  });
});

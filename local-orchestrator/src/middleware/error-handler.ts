import type { Request, Response, NextFunction } from "express";
import { GemorkError, isGemorkError } from "../errors.js";
import { createLogger, type Logger } from "./logger.js";
import { EventEmitter } from "events";

export interface ErrorEvent {
  timestamp: string;
  code: string;
  module: string;
  message: string;
  recoverable: boolean;
  context?: Record<string, unknown>;
  stack?: string;
}

const errorBus = new EventEmitter();
errorBus.setMaxListeners(50);
// Prevent unhandled error event crash when no listeners are attached
errorBus.on("error", () => {});

export function onError(callback: (event: ErrorEvent) => void): () => void {
  errorBus.on("error", callback);
  return () => errorBus.off("error", callback);
}

export function createErrorHandler(logger?: Logger) {
  const log = logger ?? createLogger("error-handler");

  return function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
    const isGemork = isGemorkError(err);

    const event: ErrorEvent = {
      timestamp: new Date().toISOString(),
      code: isGemork ? err.code : "UNKNOWN_ERROR",
      module: isGemork ? err.module : "server",
      message: err.message,
      recoverable: isGemork ? err.recoverable : false,
      context: isGemork ? err.context : undefined,
      stack: err.stack,
    };

    log.error(`${event.module}/${event.code}: ${event.message}`, {
      recoverable: event.recoverable,
      stack: event.stack,
    });

    errorBus.emit("error", event);

    const statusCode = isGemork ? gemorkStatus(err) : 500;

    res.status(statusCode).json({
      error: event.message,
      code: event.code,
      recoverable: event.recoverable,
    });
  };
}

function gemorkStatus(err: GemorkError): number {
  switch (err.code) {
    case "GUARDRAIL_PERMISSION_DENIED":
      return 403;
    case "GUARDRAIL_APPROVAL_TIMEOUT":
      return 408;
    case "CONNECTOR_NOT_FOUND":
      return 404;
    case "CONNECTOR_AUTH_EXPIRED":
      return 401;
    case "CONNECTOR_RATE_LIMITED":
      return 429;
    default:
      return 500;
  }
}

export function createAsyncHandler(
  fn: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

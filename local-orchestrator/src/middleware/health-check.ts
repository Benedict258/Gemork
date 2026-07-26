import type { Request, Response } from "express";
import { createLogger } from "./logger.js";

const log = createLogger("health-check");
const startedAt = Date.now();

export interface ModuleHealth {
  status: "ok" | "degraded" | "down";
  message?: string;
}

export type HealthChecker = () => ModuleHealth | Promise<ModuleHealth>;

const modules = new Map<string, HealthChecker>();

export function registerHealthCheck(name: string, checker: HealthChecker): void {
  modules.set(name, checker);
}

export async function healthCheckHandler(_req: Request, res: Response): Promise<void> {
  const moduleStatus: Record<string, ModuleHealth> = {};
  let overallStatus: "ok" | "degraded" | "down" = "ok";

  for (const [name, check] of modules) {
    try {
      const result = await check();
      moduleStatus[name] = result;
      if (result.status === "down") overallStatus = "down";
      else if (result.status === "degraded" && overallStatus !== "down") overallStatus = "degraded";
    } catch (err) {
      moduleStatus[name] = {
        status: "down",
        message: err instanceof Error ? err.message : "Health check failed",
      };
      overallStatus = "down";
    }
  }

  const response = {
    status: overallStatus,
    version: process.env.npm_package_version ?? "0.1.0",
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    modules: moduleStatus,
  };

  const statusCode = overallStatus === "down" ? 503 : 200;
  log.debug("Health check", { status: overallStatus, moduleCount: Object.keys(moduleStatus).length });
  res.status(statusCode).json(response);
}

export function createDefaultHealthChecks(): void {
  registerHealthCheck("orchestrator", () => ({ status: "ok" }));
  registerHealthCheck("llm", () => ({ status: "ok" }));
  registerHealthCheck("connectors", () => ({ status: "ok" }));
}

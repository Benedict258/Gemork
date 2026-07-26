import express from "express";
import { createServer } from "http";
import { TaskEngine } from "./orchestrator/task-engine.js";
import { EventBroadcaster, type OrchestratorEvent } from "./orchestrator/event-bus.js";
import { GuardrailEngine } from "./guardrail-engine.js";
import { SnapshotService } from "./snapshot-service.js";
import { MemoryStore } from "./memory-store.js";
import { WebSocketServer, WebSocket } from "ws";
import { createErrorHandler, createAsyncHandler } from "./middleware/error-handler.js";
import { createLogger } from "./middleware/logger.js";
import { healthCheckHandler, createDefaultHealthChecks } from "./middleware/health-check.js";

const PORT = parseInt(process.env.PORT || "3001", 10);
const WS_PORT = parseInt(process.env.WS_PORT || "8080", 10);

const log = createLogger("server");

// ── Core Instances ───────────────────────────────────────────

const taskEngine = new TaskEngine({ maxConcurrency: 3 });
const guardrails = new GuardrailEngine();
const snapshots = new SnapshotService();
const memory = new MemoryStore();
const eventBus = taskEngine.getEventBus();
const broadcaster = new EventBroadcaster();

// ── Health Checks ───────────────────────────────────────────

createDefaultHealthChecks();

// ── HTTP Server ──────────────────────────────────────────────

const app = express();
app.use(express.json());

const httpServer = createServer(app);

const errorHandler = createErrorHandler(log);

// GET /api/health — health check
app.get("/api/health", healthCheckHandler);

// POST /api/goals — submit a new goal
app.post(
  "/api/goals",
  createAsyncHandler(async (req, res) => {
    const { text } = req.body;
    if (!text || typeof text !== "string") {
      res.status(400).json({ error: "text is required" });
      return;
    }
    log.info("Goal submitted", { textLength: text.length });
    const result = await taskEngine.run({ goal: text });
    res.json(result);
  }),
);

// GET /api/plans — list all plans
app.get("/api/plans", (_req, res) => {
  res.json({ plans: taskEngine.getAllPlans() });
});

// GET /api/plans/:id — get a specific plan
app.get("/api/plans/:id", (req, res) => {
  const plan = taskEngine.getPlan(req.params.id);
  if (!plan) {
    res.status(404).json({ error: "Plan not found" });
    return;
  }
  res.json({ plan });
});

// POST /api/plans/:planId/steps/:stepId/approve — approve a tier 3 step
app.post(
  "/api/plans/:planId/steps/:stepId/approve",
  createAsyncHandler(async (req, res) => {
    const step = taskEngine.approveStep(req.params.planId, req.params.stepId);
    log.info("Step approved", { planId: req.params.planId, stepId: req.params.stepId });
    res.json({ ok: true, step });
  }),
);

// POST /api/plans/:planId/steps/:stepId/reject — reject a tier 3 step
app.post(
  "/api/plans/:planId/steps/:stepId/reject",
  createAsyncHandler(async (req, res) => {
    const { reason } = req.body;
    const step = taskEngine.rejectStep(req.params.planId, req.params.stepId, reason);
    log.info("Step rejected", { planId: req.params.planId, stepId: req.params.stepId, reason });
    res.json({ ok: true, step });
  }),
);

// POST /api/plans/:planId/pause — pause an active plan
app.post(
  "/api/plans/:planId/pause",
  createAsyncHandler(async (req, res) => {
    taskEngine.pausePlan(req.params.planId);
    log.info("Plan paused", { planId: req.params.planId });
    res.json({ ok: true });
  }),
);

// GET /api/memory/:projectId — query project memory
app.get(
  "/api/memory/:projectId",
  createAsyncHandler(async (req, res) => {
    const entries = await memory.queryByProject(req.params.projectId);
    res.json({ entries });
  }),
);

// Error handler (must be last)
app.use(errorHandler);

// ── WebSocket Server ────────────────────────────────────────

const wss = new WebSocketServer({ port: WS_PORT });

wss.on("connection", (ws) => {
  broadcaster.addClient(ws);
  ws.on("close", () => broadcaster.removeClient(ws));
});

broadcaster.attach(eventBus);

// ── Start ───────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  log.info("Gemork Orchestrator started", { port: PORT, wsPort: WS_PORT });
});

export { app, httpServer, taskEngine, eventBus, broadcaster, guardrails, snapshots, memory };

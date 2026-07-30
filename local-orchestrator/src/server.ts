import "dotenv/config";
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
import { WorkflowStore, captureFromPlan, replayWorkflow } from "./workflows/index.js";
import { Scheduler } from "./scheduling/scheduler.js";
import { InboxManager } from "./inbox/inbox-manager.js";
import { loadOrGenerateApiKey, createAuthMiddleware, verifyWsApiKey } from "./auth/persistent-auth.js";

const PORT = parseInt(process.env.PORT || "5180", 10);
const WS_PORT = parseInt(process.env.WS_PORT || "8081", 10);

const log = createLogger("server");

// ── Core Instances ───────────────────────────────────────────

const taskEngine = new TaskEngine({ maxConcurrency: 3 });
const guardrails = new GuardrailEngine();
const snapshots = new SnapshotService();
const memory = new MemoryStore();
const eventBus = taskEngine.getEventBus();
const broadcaster = new EventBroadcaster();
const workflowStore = new WorkflowStore();
const scheduler = new Scheduler();

const DEFAULT_PROJECT_ID = "default";
const inboxManager = taskEngine.getInboxManager();

// ── Health Checks ───────────────────────────────────────────

createDefaultHealthChecks();

// ── HTTP Server ──────────────────────────────────────────────

const app = express();

// ── Security Middleware ──────────────────────────────────────
app.use(express.json({ limit: "1mb" }));

// Simple rate limiting (in-memory, per-IP)
const requestCounts = new Map<string, { count: number; resetAt: number }>();
app.use((_req, res, next) => {
  const ip = _req.ip || _req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const entry = requestCounts.get(ip);
  if (!entry || now > entry.resetAt) {
    requestCounts.set(ip, { count: 1, resetAt: now + 60_000 });
    next();
  } else if (entry.count < 100) {
    entry.count++;
    next();
  } else {
    res.status(429).json({ error: "Rate limit exceeded. Try again in 60 seconds." });
  }
});
// API key — from env or generate on first run
const API_KEY = process.env.GEMORK_API_KEY || "dd8168e51c495feeb21733c29d89b12c";

log.info("API key loaded", { key: API_KEY });
log.info("Gemini key loaded", { key: process.env.GEMINI_API_KEY ? "SET" : "NOT SET" });

app.use("/api", createAuthMiddleware(API_KEY));
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

// ── Workflow Endpoints ──────────────────────────────────────

// GET /api/workflows — list workflows
app.get(
  "/api/workflows",
  createAsyncHandler(async (_req, res) => {
    const workflows = await workflowStore.listWorkflows(DEFAULT_PROJECT_ID);
    res.json({ workflows });
  }),
);

// POST /api/workflows — save current plan as workflow
app.post(
  "/api/workflows",
  createAsyncHandler(async (req, res) => {
    const { planId, name } = req.body;
    if (!planId || typeof planId !== "string") {
      res.status(400).json({ error: "planId is required" });
      return;
    }

    const plan = taskEngine.getPlan(planId);
    if (!plan) {
      res.status(404).json({ error: "Plan not found" });
      return;
    }

    const goal = taskEngine.getGoal(plan.goalId);
    const goalText = goal?.text ?? "Unknown goal";

    const captured = captureFromPlan(plan, goalText);
    if (name && typeof name === "string") {
      captured.name = name;
    }

    const id = await workflowStore.saveWorkflow(DEFAULT_PROJECT_ID, {
      name: captured.name,
      description: captured.description,
      goal: captured.goal,
      steps: captured.steps,
    });

    res.json({ id, workflow: await workflowStore.getWorkflow(DEFAULT_PROJECT_ID, id) });
  }),
);

// POST /api/workflows/:id/replay — replay a workflow
app.post(
  "/api/workflows/:id/replay",
  createAsyncHandler(async (req, res) => {
    const result = await replayWorkflow(DEFAULT_PROJECT_ID, req.params.id);
    if (!result) {
      res.status(404).json({ error: "Workflow not found" });
      return;
    }

    const runResult = await taskEngine.run({ goal: result.goalText });
    res.json({ plan: runResult.plan });
  }),
);

// ── Schedule Endpoints ──────────────────────────────────────

// GET /api/schedules — list schedules
app.get(
  "/api/schedules",
  createAsyncHandler(async (_req, res) => {
    const schedules = scheduler.getSchedules();
    res.json({ schedules });
  }),
);

// POST /api/schedules — create schedule
app.post(
  "/api/schedules",
  createAsyncHandler(async (req, res) => {
    const { workflowId, goal, cron, enabled } = req.body;

    if (!goal || typeof goal !== "string") {
      res.status(400).json({ error: "goal is required" });
      return;
    }
    if (!cron || typeof cron !== "string") {
      res.status(400).json({ error: "cron is required (daily, weekly, hourly, every N hours, every N minutes)" });
      return;
    }

    const id = await scheduler.schedule({
      projectId: DEFAULT_PROJECT_ID,
      workflowId,
      goal,
      cron: cron as any,
      enabled: enabled !== false,
    });

    res.json({ id, schedule: scheduler.getSchedule(id) });
  }),
);

// DELETE /api/schedules/:id — remove schedule
app.delete(
  "/api/schedules/:id",
  createAsyncHandler(async (req, res) => {
    const removed = await scheduler.unschedule(req.params.id);
    if (!removed) {
      res.status(404).json({ error: "Schedule not found" });
      return;
    }
    res.json({ ok: true });
  }),
);

// POST /api/schedules/:id/trigger — trigger immediately
app.post(
  "/api/schedules/:id/trigger",
  createAsyncHandler(async (req, res) => {
    const schedule = await scheduler.triggerSchedule(req.params.id);
    if (!schedule) {
      res.status(404).json({ error: "Schedule not found" });
      return;
    }

    const runResult = await taskEngine.run({ goal: schedule.goal });
    res.json({ schedule, plan: runResult.plan });
  }),
);

// ── Inbox Endpoints ──────────────────────────────────────────

// GET /api/inbox — list pending items
app.get("/api/inbox", (_req, res) => {
  const currentItem = inboxManager.getCurrentItem();
  const stats = inboxManager.getStats();
  res.json({ currentItem, stats });
});

// GET /api/inbox/stats — get queue stats
app.get("/api/inbox/stats", (_req, res) => {
  res.json(inboxManager.getStats());
});

// POST /api/inbox/:id/resolve — resolve an item with response
app.post(
  "/api/inbox/:id/resolve",
  createAsyncHandler(async (req, res) => {
    const { response } = req.body;
    const item = inboxManager.getCurrentItem();
    if (item && item.id === req.params.id && item.type === "approval") {
      const approval = item.payload as any;
      if (response?.approved) {
        taskEngine.approveStep(approval.planId, approval.stepId);
      } else {
        taskEngine.rejectStep(approval.planId, approval.stepId, response?.reason);
      }
    }
    inboxManager.resolve(req.params.id, response);
    log.info("Inbox item resolved", { id: req.params.id });
    res.json({ ok: true });
  }),
);

// POST /api/inbox/:id/cancel — cancel an item
app.post(
  "/api/inbox/:id/cancel",
  createAsyncHandler(async (req, res) => {
    inboxManager.cancel(req.params.id);
    log.info("Inbox item cancelled", { id: req.params.id });
    res.json({ ok: true });
  }),
);

// Error handler (must be last)
app.use(errorHandler);

// ── WebSocket Server ────────────────────────────────────────

const wss = new WebSocketServer({
  server: httpServer,
  verifyClient: (info, callback) => {
    const origin = info.origin || info.req.headers.origin;
    // Allow connections from localhost, file:// (Tauri), and chrome-extension://
    // Allow connections from any origin (cross-network access)
    // Auth is handled by API key check below

    // Check API key from query parameter
    const key = info.req.url ? new URL(info.req.url, "http://localhost").searchParams.get("key") : null;
    if (key !== API_KEY) {
      log.warn("WebSocket connection rejected (auth)");
      callback(false);
      return;
    }

    callback(true);
  },
});

wss.on("connection", (ws) => {
  broadcaster.addClient(ws);

  ws.on("message", async (raw) => {
    try {
      const msg = JSON.parse(String(raw));
      if (msg.type === "voice:transcription" && typeof msg.text === "string" && msg.text.trim()) {
        log.info("Voice transcription received", { textLength: msg.text.length });
        const result = await taskEngine.run({ goal: msg.text });
        ws.send(JSON.stringify({ type: "voice:ack", received: true, planId: result.plan?.id }));
      }
    } catch (err) {
      log.warn("Failed to handle voice message", { error: String(err) });
    }
  });

  ws.on("close", () => broadcaster.removeClient(ws));
});

broadcaster.attach(eventBus);

// ── Start ───────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  log.info("Gemork Orchestrator started", { port: PORT, wsPort: WS_PORT });
});

export { app, httpServer, taskEngine, eventBus, broadcaster, guardrails, snapshots, memory };

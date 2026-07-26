import express from "express";
import { createServer } from "http";
import { TaskEngine } from "./orchestrator/task-engine.js";
import { EventBroadcaster, type OrchestratorEvent } from "./orchestrator/event-bus.js";
import { GuardrailEngine } from "./guardrail-engine.js";
import { SnapshotService } from "./snapshot-service.js";
import { MemoryStore } from "./memory-store.js";
import { WebSocketServer, WebSocket } from "ws";

const PORT = parseInt(process.env.PORT || "3001", 10);
const WS_PORT = parseInt(process.env.WS_PORT || "8080", 10);

// ── Core Instances ───────────────────────────────────────────

const taskEngine = new TaskEngine({ maxConcurrency: 3 });
const guardrails = new GuardrailEngine();
const snapshots = new SnapshotService();
const memory = new MemoryStore();
const eventBus = taskEngine.getEventBus();
const broadcaster = new EventBroadcaster();

// ── HTTP Server ──────────────────────────────────────────────

const app = express();
app.use(express.json());

const httpServer = createServer(app);

// POST /api/goals — submit a new goal
app.post("/api/goals", async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "text is required" });
    }
    const result = await taskEngine.run({ goal: text });
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

// GET /api/plans — list all plans
app.get("/api/plans", (_req, res) => {
  res.json({ plans: taskEngine.getAllPlans() });
});

// GET /api/plans/:id — get a specific plan
app.get("/api/plans/:id", (req, res) => {
  const plan = taskEngine.getPlan(req.params.id);
  if (!plan) return res.status(404).json({ error: "Plan not found" });
  res.json({ plan });
});

// POST /api/plans/:planId/steps/:stepId/approve — approve a tier 3 step
app.post("/api/plans/:planId/steps/:stepId/approve", (req, res) => {
  try {
    const step = taskEngine.approveStep(req.params.planId, req.params.stepId);
    res.json({ ok: true, step });
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

// POST /api/plans/:planId/steps/:stepId/reject — reject a tier 3 step
app.post("/api/plans/:planId/steps/:stepId/reject", (req, res) => {
  try {
    const { reason } = req.body;
    const step = taskEngine.rejectStep(req.params.planId, req.params.stepId, reason);
    res.json({ ok: true, step });
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

// POST /api/plans/:planId/pause — pause an active plan
app.post("/api/plans/:planId/pause", (req, res) => {
  taskEngine.pausePlan(req.params.planId);
  res.json({ ok: true });
});

// GET /api/memory/:projectId — query project memory
app.get("/api/memory/:projectId", async (req, res) => {
  const entries = await memory.queryByProject(req.params.projectId);
  res.json({ entries });
});

// ── WebSocket Server ────────────────────────────────────────

const wss = new WebSocketServer({ port: WS_PORT });

// Attach broadcaster to all incoming connections
wss.on("connection", (ws) => {
  broadcaster.addClient(ws);
  ws.on("close", () => broadcaster.removeClient(ws));
});

// Forward all orchestrator events to WebSocket clients
broadcaster.attach(eventBus);

// ── Start ───────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log(`Gemork Orchestrator running on http://localhost:${PORT}`);
  console.log(`WebSocket server on ws://localhost:${WS_PORT}`);
});

export { app, httpServer, taskEngine, eventBus, broadcaster, guardrails, snapshots, memory };

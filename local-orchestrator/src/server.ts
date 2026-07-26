import express from "express";
import { createServer } from "http";
import { GemorkOrchestrator } from "./orchestrator.js";
import { GuardrailEngine } from "./guardrail-engine.js";
import { SnapshotService } from "./snapshot-service.js";
import { MemoryStore } from "./memory-store.js";
import { SubAgentCoordinator } from "./sub-agent-coordinator.js";
import { LivePlanServer } from "./websocket-server.js";

const PORT = parseInt(process.env.PORT || "3001", 10);

const orchestrator = new GemorkOrchestrator();
const guardrails = new GuardrailEngine();
const snapshots = new SnapshotService();
const memory = new MemoryStore();
const subAgents = new SubAgentCoordinator();
const wsServer = new LivePlanServer(8080);

const app = express();
app.use(express.json());

const httpServer = createServer(app);

// POST /api/goals — submit a new goal
app.post("/api/goals", async (req, res) => {
  const { text } = req.body;
  if (!text || typeof text !== "string") {
    return res.status(400).json({ error: "text is required" });
  }
  const plan = await orchestrator.submitGoal(text);
  wsServer.broadcastPlanUpdate(plan);
  res.json({ plan });
});

// GET /api/plans — list all plans
app.get("/api/plans", (_req, res) => {
  res.json({ plans: orchestrator.getAllPlans() });
});

// GET /api/plans/:id — get a specific plan
app.get("/api/plans/:id", (req, res) => {
  const plan = orchestrator.getPlan(req.params.id);
  if (!plan) return res.status(404).json({ error: "Plan not found" });
  res.json({ plan });
});

// POST /api/plans/:planId/steps/:stepId/approve — approve a tier 3 step
app.post("/api/plans/:planId/steps/:stepId/approve", async (req, res) => {
  try {
    await orchestrator.approveStep(req.params.planId, req.params.stepId);
    wsServer.broadcastStepUpdate(req.params.planId, { id: req.params.stepId, status: "pending" });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(404).json({ error: e.message });
  }
});

// POST /api/plans/:planId/steps/:stepId/reject — reject a tier 3 step
app.post("/api/plans/:planId/steps/:stepId/reject", async (req, res) => {
  try {
    await orchestrator.rejectStep(req.params.planId, req.params.stepId);
    wsServer.broadcastStepUpdate(req.params.planId, { id: req.params.stepId, status: "failed" });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(404).json({ error: e.message });
  }
});

// GET /api/memory/:projectId — query project memory
app.get("/api/memory/:projectId", async (req, res) => {
  const entries = await memory.queryByProject(req.params.projectId);
  res.json({ entries });
});

httpServer.listen(PORT, () => {
  console.log(`Gemork Orchestrator running on http://localhost:${PORT}`);
  console.log(`WebSocket server on ws://localhost:8080`);
});

export { app, orchestrator, guardrails, snapshots, memory, subAgents };

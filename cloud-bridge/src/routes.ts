import { Router, Request, Response } from "express";
import {
  createSession,
  getSession,
  listSessions,
  removeSession,
} from "./session-manager.js";
import { getOrCreateToken } from "./auth.js";
import type { RelayClient } from "./relay.js";

export function createRoutes(relays: Map<string, RelayClient>): Router {
  const router = Router();
  const token = getOrCreateToken();

  router.get("/health", (_req: Request, res: Response) => {
    const sessions = listSessions();
    const anyConnected = sessions.some((s) => s.orchestratorConnected);
    res.json({
      status: "ok",
      sessions: sessions.length,
      orchestratorConnected: anyConnected,
    });
  });

  router.post("/sessions", (_req: Request, res: Response) => {
    const sessionId = createSession();
    const relayUrl = `ws://localhost:${process.env.WS_PORT || 8082}?token=${token}&session=${sessionId}`;
    res.json({ sessionId, relayUrl, token });
  });

  router.get("/sessions", (_req: Request, res: Response) => {
    res.json(listSessions());
  });

  router.get("/sessions/:id", (req: Request, res: Response) => {
    const session = getSession(req.params.id);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }
    res.json(session);
  });

  router.delete("/sessions/:id", (req: Request, res: Response) => {
    const relay = relays.get(req.params.id);
    if (relay) {
      relay.close();
      relays.delete(req.params.id);
    }
    const removed = removeSession(req.params.id);
    if (!removed) {
      return res.status(404).json({ error: "Session not found" });
    }
    res.json({ ok: true });
  });

  router.post(
    "/relay/:sessionId/message",
    (req: Request, res: Response) => {
      const { sessionId } = req.params;
      const { message } = req.body;
      const relay = relays.get(sessionId);
      if (!relay || !relay.getOrchestratorConnected()) {
        return res
          .status(404)
          .json({ error: "Session not found or orchestrator disconnected" });
      }
      relay.forwardToOrchestrator(JSON.stringify(message));
      res.json({ ok: true });
    }
  );

  return router;
}

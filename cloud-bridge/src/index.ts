import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";

const PORT = parseInt(process.env.PORT || "3002", 10);

const app = express();
app.use(express.json());

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: "/relay" });

const sessions: Map<string, WebSocket> = new Map();

wss.on("connection", (ws, req) => {
  const url = new URL(req.url || "", `http://localhost:${PORT}`);
  const sessionId = url.searchParams.get("session");

  if (sessionId) {
    sessions.set(sessionId, ws);
    console.log(`[CloudBridge] Client connected for session: ${sessionId}`);

    ws.on("close", () => {
      sessions.delete(sessionId);
      console.log(`[CloudBridge] Client disconnected from session: ${sessionId}`);
    });

    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        console.log(`[CloudBridge] Received message for session ${sessionId}:`, message.type);
      } catch (e) {
        console.error("[CloudBridge] Invalid message:", e);
      }
    });
  }
});

// POST /api/relay — forward message to desktop client
app.post("/api/relay", (req, res) => {
  const { sessionId, message } = req.body;
  const client = sessions.get(sessionId);

  if (!client || client.readyState !== WebSocket.OPEN) {
    return res.status(404).json({ error: "Session not found or disconnected" });
  }

  client.send(JSON.stringify(message));
  res.json({ ok: true });
});

// GET /api/health — health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", sessions: sessions.size });
});

httpServer.listen(PORT, () => {
  console.log(`[CloudBridge] Running on http://localhost:${PORT}`);
  console.log(`[CloudBridge] WebSocket relay on ws://localhost:${PORT}/relay`);
});

export { app };

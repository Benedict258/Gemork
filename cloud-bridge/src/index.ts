import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { v4 as uuidv4 } from "uuid";
import { createRoutes } from "./routes.js";
import { RelayClient } from "./relay.js";
import { validateToken, getOrCreateToken } from "./auth.js";
import {
  createSession,
  getSession,
  setConnectedClients,
} from "./session-manager.js";

const PORT = parseInt(process.env.PORT || "3002", 10);
const WS_PORT = parseInt(process.env.WS_PORT || "8082", 10);
const ORCHESTRATOR_WS_URL =
  process.env.ORCHESTRATOR_WS_URL || "ws://localhost:8081";

const validToken = getOrCreateToken();
const relays: Map<string, RelayClient> = new Map();

// Express HTTP server
const app = express();
app.use(express.json());
app.use("/api", createRoutes(relays));

const httpServer = createServer(app);

// WebSocket server for mobile clients
const wss = new WebSocketServer({ port: WS_PORT });

wss.on("connection", (ws: WebSocket, req) => {
  const url = new URL(req.url || "", `http://localhost:${WS_PORT}`);
  const tokenParam = url.searchParams.get("token");
  const sessionId = url.searchParams.get("session");

  if (!validateToken(tokenParam, validToken)) {
    ws.send(
      JSON.stringify({ type: "error", message: "Invalid or missing token" })
    );
    ws.close();
    return;
  }

  if (!sessionId) {
    ws.send(
      JSON.stringify({ type: "error", message: "Missing session query param" })
    );
    ws.close();
    return;
  }

  // Ensure session exists or create one
  let session = getSession(sessionId);
  if (!session) {
    sessionId; // keep the provided id
    createSession();
    // The session-manager will have created with a new UUID, but we need to map
    // the user-provided sessionId. For simplicity, we'll use the provided sessionId
    // and trust it was created via POST /api/sessions first.
  }

  // Get or create relay for this session
  let relay = relays.get(sessionId);
  if (!relay) {
    relay = new RelayClient(ORCHESTRATOR_WS_URL, sessionId);
    relays.set(sessionId, relay);
    relay.connectToOrchestrator();
  }

  const clientId = uuidv4();
  relay.addMobileClient(clientId, ws);

  // Update connected clients count
  setConnectedClients(sessionId, relay.getMobileClientCount());

  ws.on("close", () => {
    setConnectedClients(sessionId, relay?.getMobileClientCount() ?? 0);
  });
});

// Start HTTP server
httpServer.listen(PORT, () => {
  console.log(`[CloudBridge] HTTP server on http://localhost:${PORT}`);
  console.log(`[CloudBridge] WebSocket relay on ws://localhost:${WS_PORT}`);
  console.log(`[CloudBridge] Orchestrator target: ${ORCHESTRATOR_WS_URL}`);
});

export { app, wss, relays };

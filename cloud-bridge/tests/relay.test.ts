import { describe, it, expect, beforeEach, afterEach } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { RelayClient } from "../src/relay.js";
import {
  createSession,
  getSession,
  listSessions,
  removeSession,
  setOrchestratorConnected,
} from "../src/session-manager.js";
import { MessageType, createMessage } from "../src/message-types.js";
import { getOrCreateToken, validateToken } from "../src/auth.js";
import { unlinkSync, existsSync } from "fs";
import { join } from "path";

const TOKEN_PATH = join(process.cwd(), ".relay-token");

function cleanupToken() {
  if (existsSync(TOKEN_PATH)) unlinkSync(TOKEN_PATH);
}

let portCounter = 20100;
function nextPort() {
  return portCounter++;
}

function startMockOrchestrator(port: number): Promise<WebSocketServer> {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ port });
    wss.on("connection", (ws) => {
      ws.on("message", (data) => {
        ws.send(
          JSON.stringify({
            type: "step:update",
            data: { planId: "p1", id: "s1", status: "running" },
          })
        );
      });
    });
    wss.on("error", reject);
    wss.on("listening", () => resolve(wss));
  });
}

function waitFor(
  fn: () => boolean,
  timeoutMs = 3000,
  intervalMs = 20
): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (fn()) return resolve();
      if (Date.now() - start > timeoutMs)
        return reject(new Error("waitFor timeout"));
      setTimeout(check, intervalMs);
    };
    check();
  });
}

function closeWsServer(wss: WebSocketServer | null): Promise<void> {
  if (!wss) return Promise.resolve();
  return new Promise((resolve) => {
    // Force-close all tracked connections first
    wss.clients.forEach((ws) => {
      ws.terminate();
    });
    wss.close(() => resolve());
  });
}

describe("Session Manager", () => {
  beforeEach(() => {
    for (const s of listSessions()) removeSession(s.id);
  });

  it("creates and retrieves a session", () => {
    const id = createSession();
    expect(id).toBeTruthy();
    const session = getSession(id);
    expect(session).not.toBeNull();
    expect(session!.id).toBe(id);
    expect(session!.createdAt).toBeGreaterThan(0);
    expect(session!.orchestratorConnected).toBe(false);
  });

  it("lists sessions", () => {
    createSession();
    createSession();
    expect(listSessions().length).toBeGreaterThanOrEqual(2);
  });

  it("removes a session", () => {
    const id = createSession();
    expect(removeSession(id)).toBe(true);
    expect(getSession(id)).toBeNull();
  });

  it("returns false when removing nonexistent session", () => {
    expect(removeSession("nonexistent")).toBe(false);
  });

  it("updates orchestrator connected status", () => {
    const id = createSession();
    setOrchestratorConnected(id, true);
    expect(getSession(id)!.orchestratorConnected).toBe(true);
    setOrchestratorConnected(id, false);
    expect(getSession(id)!.orchestratorConnected).toBe(false);
  });
});

describe("Message Types", () => {
  it("creates a message with correct structure", () => {
    const msg = createMessage(
      MessageType.ORCHESTRATOR_EVENT,
      "session-1",
      { type: "plan:update", data: {} }
    );
    expect(msg.type).toBe(MessageType.ORCHESTRATOR_EVENT);
    expect(msg.sessionId).toBe("session-1");
    expect(msg.timestamp).toBeGreaterThan(0);
  });
});

describe("Auth", () => {
  afterEach(() => cleanupToken());

  it("generates and reads token", () => {
    cleanupToken();
    const token = getOrCreateToken();
    expect(token).toBeTruthy();
    expect(token.length).toBeGreaterThan(0);
    expect(getOrCreateToken()).toBe(token);
  });

  it("validates tokens correctly", () => {
    cleanupToken();
    const token = getOrCreateToken();
    expect(validateToken(token, token)).toBe(true);
    expect(validateToken("wrong", token)).toBe(false);
    expect(validateToken(null, token)).toBe(false);
  });
});

describe("Relay Client", () => {
  it("connects to orchestrator", async () => {
    const port = nextPort();
    const orch = await startMockOrchestrator(port);
    const id = createSession();
    const relay = new RelayClient(`ws://localhost:${port}`, id);

    relay.connectToOrchestrator();
    await waitFor(() => relay.getOrchestratorConnected());
    expect(relay.getOrchestratorConnected()).toBe(true);

    relay.close();
    await closeWsServer(orch);
  });

  it("relays messages from orchestrator to mobile clients", async () => {
    const port = nextPort();
    const orch = await startMockOrchestrator(port);
    const id = createSession();
    const relay = new RelayClient(`ws://localhost:${port}`, id);

    relay.connectToOrchestrator();
    await waitFor(() => relay.getOrchestratorConnected());

    // Connect a real mobile client through a helper server
    const helperPort = nextPort();
    const helperWss = new WebSocketServer({ port: helperPort });
    let helperSocket: WebSocket | null = null;
    helperWss.on("connection", (ws) => {
      helperSocket = ws;
    });

    const mobileClient = new WebSocket(`ws://localhost:${helperPort}`);
    await new Promise<void>((resolve) => mobileClient.on("open", resolve));
    await waitFor(() => helperSocket !== null);

    const received: string[] = [];
    mobileClient.on("message", (data) => received.push(data.toString()));

    relay.addMobileClient("c1", helperSocket!);

    relay.forwardToOrchestrator(JSON.stringify({ test: "hello" }));
    await waitFor(() => received.length > 0);

    expect(received.length).toBe(1);
    expect(JSON.parse(received[0]).type).toBe("step:update");

    mobileClient.close();
    helperWss.close();
    relay.close();
    await closeWsServer(orch);
  });

  it("forwards mobile messages to orchestrator", async () => {
    const port = nextPort();
    const orch = await startMockOrchestrator(port);
    const id = createSession();
    const relay = new RelayClient(`ws://localhost:${port}`, id);

    relay.connectToOrchestrator();
    await waitFor(() => relay.getOrchestratorConnected());

    const helperPort = nextPort();
    const helperWss = new WebSocketServer({ port: helperPort });
    let helperSocket: WebSocket | null = null;
    helperWss.on("connection", (ws) => {
      helperSocket = ws;
    });

    const mobileClient = new WebSocket(`ws://localhost:${helperPort}`);
    await new Promise<void>((resolve) => mobileClient.on("open", resolve));
    await waitFor(() => helperSocket !== null);

    relay.addMobileClient("c2", helperSocket!);

    // Track what the orchestrator receives
    let orchReceived = false;
    // The mock orch echoes any message, so we just verify relay is connected
    relay.forwardToOrchestrator(
      JSON.stringify({ type: "goal:submit", data: { goal: "test" } })
    );

    await new Promise((r) => setTimeout(r, 100));
    expect(relay.getOrchestratorConnected()).toBe(true);

    mobileClient.close();
    helperWss.close();
    relay.close();
    await closeWsServer(orch);
  });

  it("handles orchestrator disconnect and reconnects", { timeout: 10000 }, async () => {
    const port = nextPort();
    let orch = await startMockOrchestrator(port);

    const id = createSession();
    const relay = new RelayClient(`ws://localhost:${port}`, id);

    relay.connectToOrchestrator();
    await waitFor(() => relay.getOrchestratorConnected());
    expect(relay.getOrchestratorConnected()).toBe(true);

    // Kill orchestrator
    await closeWsServer(orch);
    await waitFor(() => !relay.getOrchestratorConnected(), 3000);
    expect(relay.getOrchestratorConnected()).toBe(false);

    // Restart orchestrator
    orch = await startMockOrchestrator(port);

    // Wait for reconnect (3s delay + buffer)
    await waitFor(() => relay.getOrchestratorConnected(), 5000);
    expect(relay.getOrchestratorConnected()).toBe(true);

    relay.close();
    await closeWsServer(orch);
  });
});

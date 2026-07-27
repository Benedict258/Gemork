import WebSocket from "ws";
import { MessageType, createMessage } from "./message-types.js";
import {
  setOrchestratorConnected,
  updateActivity,
} from "./session-manager.js";

const RECONNECT_DELAY = 3000;

export interface MobileClient {
  id: string;
  ws: WebSocket;
  sessionId: string;
}

export class RelayClient {
  private orchestratorUrl: string;
  private sessionId: string;
  private mobileClients: Map<string, MobileClient> = new Map();
  private orchestratorWs: WebSocket | null = null;
  private _orchestratorConnected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(orchestratorUrl: string, sessionId: string) {
    this.orchestratorUrl = orchestratorUrl;
    this.sessionId = sessionId;
  }

  connectToOrchestrator(): void {
    if (this.closed) return;

    try {
      this.orchestratorWs = new WebSocket(this.orchestratorUrl);
    } catch (err) {
      console.error(`[Relay:${this.sessionId}] Failed to create WebSocket:`, err);
      this.scheduleReconnect();
      return;
    }

    this.orchestratorWs.on("open", () => {
      console.log(
        `[Relay:${this.sessionId}] Connected to orchestrator at ${this.orchestratorUrl}`
      );
      this._orchestratorConnected = true;
      setOrchestratorConnected(this.sessionId, true);
    });

    this.orchestratorWs.on("message", (data: WebSocket.Data) => {
      const message = data.toString();
      this.broadcastToMobileClients(message);
    });

    this.orchestratorWs.on("close", () => {
      console.log(`[Relay:${this.sessionId}] Disconnected from orchestrator`);
      this._orchestratorConnected = false;
      setOrchestratorConnected(this.sessionId, false);
      if (!this.closed) this.scheduleReconnect();
    });

    this.orchestratorWs.on("error", (err: Error) => {
      console.error(
        `[Relay:${this.sessionId}] Orchestrator connection error:`,
        err.message
      );
      this._orchestratorConnected = false;
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.closed) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      console.log(`[Relay:${this.sessionId}] Attempting reconnect...`);
      this.connectToOrchestrator();
    }, RECONNECT_DELAY);
  }

  private broadcastToMobileClients(message: string): void {
    for (const client of this.mobileClients.values()) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(message);
      }
    }
  }

  addMobileClient(clientId: string, ws: WebSocket): void {
    this.mobileClients.set(clientId, {
      id: clientId,
      ws,
      sessionId: this.sessionId,
    });
    updateActivity(this.sessionId);
    console.log(
      `[Relay:${this.sessionId}] Mobile client ${clientId} connected (${this.mobileClients.size} total)`
    );

    ws.on("close", () => {
      this.mobileClients.delete(clientId);
      console.log(
        `[Relay:${this.sessionId}] Mobile client ${clientId} disconnected (${this.mobileClients.size} remaining)`
      );
    });

    ws.on("message", (data: WebSocket.Data) => {
      updateActivity(this.sessionId);
      const message = data.toString();
      this.forwardToOrchestrator(message);
    });
  }

  forwardToOrchestrator(message: string): void {
    if (this.orchestratorWs?.readyState === WebSocket.OPEN) {
      this.orchestratorWs.send(message);
    } else {
      console.warn(
        `[Relay:${this.sessionId}] Cannot forward — orchestrator not connected`
      );
    }
  }

  getOrchestratorConnected(): boolean {
    return this._orchestratorConnected && this.orchestratorWs?.readyState === WebSocket.OPEN;
  }

  getMobileClientCount(): number {
    return this.mobileClients.size;
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    for (const client of this.mobileClients.values()) {
      client.ws.close();
    }
    this.orchestratorWs?.close();
  }
}

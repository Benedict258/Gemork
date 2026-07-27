import { RelayMessage, ConnectionState, Plan, PlanStep } from "../types";
import { CONFIG } from "../config";

type Listener = (msg: RelayMessage) => void;

class RelayClient {
  private ws: WebSocket | null = null;
  private url: string = CONFIG.defaultRelayUrl;
  private token: string = "";
  private listeners: Listener[] = [];
  private _state: ConnectionState = "disconnected";
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;

  get state(): ConnectionState {
    return this._state;
  }

  get relayUrl(): string {
    return this.url;
  }

  connect(url: string, token: string) {
    this.url = url;
    this.token = token;
    this.intentionalClose = false;
    this._setState("connecting");
    this.createSocket();
  }

  disconnect() {
    this.intentionalClose = true;
    this.clearReconnect();
    this.ws?.close();
    this.ws = null;
    this._setState("disconnected");
  }

  send(msg: RelayMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  submitGoal(goal: string) {
    this.send({ type: "goal:submit", goal });
  }

  respondApproval(planId: string, stepId: string, approved: boolean) {
    this.send({ type: "approval:response", planId, stepId, approved });
  }

  pausePlan(planId: string) {
    this.send({ type: "steer:pause", planId });
  }

  resumePlan(planId: string) {
    this.send({ type: "steer:resume", planId });
  }

  subscribe(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private emit(msg: RelayMessage) {
    this.listeners.forEach((l) => l(msg));
  }

  private _setState(state: ConnectionState) {
    this._state = state;
    this.emit({ type: "connection:state", state } as any);
  }

  private createSocket() {
    const separator = this.url.includes("?") ? "&" : "?";
    const fullUrl = `${this.url}${separator}token=${this.token}`;

    this.ws = new WebSocket(fullUrl);

    this.ws.onopen = () => {
      this.clearReconnect();
      this._setState("connected");
    };

    this.ws.onmessage = (event) => {
      try {
        const msg: RelayMessage = JSON.parse(event.data);
        this.emit(msg);
      } catch {}
    };

    this.ws.onclose = () => {
      if (!this.intentionalClose) {
        this._setState("reconnecting");
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  private scheduleReconnect() {
    this.clearReconnect();
    this.reconnectTimer = setTimeout(() => {
      this._setState("connecting");
      this.createSocket();
    }, CONFIG.reconnectDelayMs);
  }

  private clearReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

export const relayClient = new RelayClient();

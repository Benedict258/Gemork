import { WebSocketServer, WebSocket } from "ws";
import { type Plan } from "./types.js";

export class LivePlanServer {
  private wss: WebSocketServer;
  private clients: Set<WebSocket> = new Set();

  constructor(port = 8080) {
    this.wss = new WebSocketServer({ port });

    this.wss.on("connection", (ws) => {
      this.clients.add(ws);
      ws.on("close", () => this.clients.delete(ws));
    });
  }

  broadcastPlanUpdate(plan: Plan): void {
    const message = JSON.stringify({ type: "plan:update", data: plan });
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  broadcastStepUpdate(planId: string, step: { id: string; status: string }): void {
    const message = JSON.stringify({ type: "step:update", data: { planId, ...step } });
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  broadcastApprovalRequest(planId: string, step: { id: string; description: string; tier: number }): void {
    const message = JSON.stringify({ type: "approval:request", data: { planId, ...step } });
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  close(): void {
    this.wss.close();
  }
}

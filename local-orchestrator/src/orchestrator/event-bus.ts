import { EventEmitter } from "events";
import type { Plan, PlanStep } from "./plan.js";

// ─── Event Types ─────────────────────────────────────────────

export type OrchestratorEventType =
  | "plan:created"
  | "plan:updated"
  | "plan:completed"
  | "plan:paused"
  | "step:started"
  | "step:completed"
  | "step:failed"
  | "approval:request"
  | "approval:granted"
  | "approval:rejected"
  | "subagent:queued"
  | "subagent:running"
  | "subagent:completed"
  | "subagent:failed";

export interface PlanCreatedEvent {
  type: "plan:created";
  plan: Plan;
  timestamp: Date;
}

export interface PlanUpdatedEvent {
  type: "plan:updated";
  plan: Plan;
  timestamp: Date;
}

export interface PlanCompletedEvent {
  type: "plan:completed";
  plan: Plan;
  timestamp: Date;
}

export interface PlanPausedEvent {
  type: "plan:paused";
  plan: Plan;
  reason: string;
  timestamp: Date;
}

export interface StepStartedEvent {
  type: "step:started";
  planId: string;
  step: PlanStep;
  timestamp: Date;
}

export interface StepCompletedEvent {
  type: "step:completed";
  planId: string;
  step: PlanStep;
  timestamp: Date;
}

export interface StepFailedEvent {
  type: "step:failed";
  planId: string;
  step: PlanStep;
  error: string;
  timestamp: Date;
}

export interface ApprovalRequestEvent {
  type: "approval:request";
  planId: string;
  step: PlanStep;
  timestamp: Date;
}

export interface ApprovalGrantedEvent {
  type: "approval:granted";
  planId: string;
  stepId: string;
  timestamp: Date;
}

export interface ApprovalRejectedEvent {
  type: "approval:rejected";
  planId: string;
  stepId: string;
  reason?: string;
  timestamp: Date;
}

export interface SubAgentQueuedEvent {
  type: "subagent:queued";
  planId: string;
  stepId: string;
  agentId: string;
  timestamp: Date;
}

export interface SubAgentRunningEvent {
  type: "subagent:running";
  planId: string;
  stepId: string;
  agentId: string;
  timestamp: Date;
}

export interface SubAgentCompletedEvent {
  type: "subagent:completed";
  planId: string;
  stepId: string;
  agentId: string;
  result: unknown;
  timestamp: Date;
}

export interface SubAgentFailedEvent {
  type: "subagent:failed";
  planId: string;
  stepId: string;
  agentId: string;
  error: string;
  timestamp: Date;
}

export type OrchestratorEvent =
  | PlanCreatedEvent
  | PlanUpdatedEvent
  | PlanCompletedEvent
  | PlanPausedEvent
  | StepStartedEvent
  | StepCompletedEvent
  | StepFailedEvent
  | ApprovalRequestEvent
  | ApprovalGrantedEvent
  | ApprovalRejectedEvent
  | SubAgentQueuedEvent
  | SubAgentRunningEvent
  | SubAgentCompletedEvent
  | SubAgentFailedEvent;

// ─── Typed Event Bus ─────────────────────────────────────────

export type EventHandler<T extends OrchestratorEvent = OrchestratorEvent> = (
  event: T,
) => void | Promise<void>;

export class OrchestratorEventBus extends EventEmitter {
  private handlers: Map<string, Set<EventHandler>> = new Map();

  publish<T extends OrchestratorEvent>(event: T): void {
    const handlers = this.handlers.get(event.type);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(event);
        } catch (err) {
          console.error(
            `[EventBus] Handler error for ${event.type}:`,
            err,
          );
        }
      }
    }
    this.emit(event.type, event);
  }

  subscribe<T extends OrchestratorEvent["type"]>(
    eventType: T,
    handler: EventHandler<Extract<OrchestratorEvent, { type: T }>>,
  ): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler as EventHandler);

    // Return unsubscribe function
    return () => {
      this.handlers.get(eventType)?.delete(handler as EventHandler);
    };
  }

  subscribeAll(handler: EventHandler): () => void {
    const unsubscribers: (() => void)[] = [];
    const eventTypes: OrchestratorEvent["type"][] = [
      "plan:created",
      "plan:updated",
      "plan:completed",
      "plan:paused",
      "step:started",
      "step:completed",
      "step:failed",
      "approval:request",
      "approval:granted",
      "approval:rejected",
      "subagent:queued",
      "subagent:running",
      "subagent:completed",
      "subagent:failed",
    ];

    for (const eventType of eventTypes) {
      unsubscribers.push(
        this.subscribe(eventType, handler as EventHandler),
      );
    }

    return () => {
      for (const unsub of unsubscribers) unsub();
    };
  }

  handlerCount(): number {
    let count = 0;
    for (const handlers of this.handlers.values()) {
      count += handlers.size;
    }
    return count;
  }

  clear(): void {
    this.handlers.clear();
    this.removeAllListeners();
  }
}

// ─── WebSocket Broadcaster ───────────────────────────────────

export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
}

const WS_OPEN = 1;

export class EventBroadcaster {
  private clients: Set<WebSocketLike> = new Set();

  attach(bus: OrchestratorEventBus): () => void {
    return bus.subscribeAll((event) => {
      this.broadcast(event);
    });
  }

  addClient(ws: WebSocketLike): void {
    this.clients.add(ws);
  }

  removeClient(ws: WebSocketLike): void {
    this.clients.delete(ws);
  }

  broadcast(event: OrchestratorEvent): void {
    const message = JSON.stringify(event);
    for (const client of this.clients) {
      if (client.readyState === WS_OPEN) {
        try {
          client.send(message);
        } catch {
          this.clients.delete(client);
        }
      }
    }
  }

  clientCount(): number {
    return this.clients.size;
  }
}

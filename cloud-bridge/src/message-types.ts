export enum MessageType {
  ORCHESTRATOR_EVENT = "orchestrator:event",
  MOBILE_COMMAND = "mobile:command",
  SESSION_INFO = "session:info",
  ERROR = "error",
}

export interface Message {
  type: MessageType;
  sessionId: string;
  payload: unknown;
  timestamp: number;
}

export interface OrchestratorEvent {
  type: "plan:update" | "step:update" | "approval:request";
  data: unknown;
}

export interface MobileCommand {
  type: "goal:submit" | "approval:response" | "steer:pause" | "steer:resume";
  data: unknown;
}

export function createMessage(
  type: MessageType,
  sessionId: string,
  payload: unknown
): Message {
  return { type, sessionId, payload, timestamp: Date.now() };
}

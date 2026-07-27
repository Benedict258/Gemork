export type StepStatus = "pending" | "running" | "done" | "failed" | "skipped";
export type StepTier = 1 | 2 | 3;

export interface PlanStep {
  id: string;
  number: number;
  description: string;
  tier: StepTier;
  status: StepStatus;
  rationale?: string;
  connector?: string;
}

export interface Plan {
  id: string;
  goal: string;
  steps: PlanStep[];
  status: "pending" | "running" | "paused" | "done" | "failed";
  createdAt: string;
  updatedAt: string;
}

export interface SessionInfo {
  sessionId: string;
  connectedAt: string;
  relayUrl: string;
}

export type ConnectionState = "connecting" | "connected" | "reconnecting" | "disconnected";

export type RelayMessage =
  | { type: "plan:update"; plan: Plan }
  | { type: "step:update"; planId: string; step: PlanStep }
  | { type: "approval:request"; planId: string; step: PlanStep }
  | { type: "goal:submit"; goal: string }
  | { type: "approval:response"; planId: string; stepId: string; approved: boolean }
  | { type: "steer:pause"; planId: string }
  | { type: "steer:resume"; planId: string };

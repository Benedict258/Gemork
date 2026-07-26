export type StepTier = 1 | 2 | 3;

export type StepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "awaiting_approval";

export type PlanStatus =
  | "generating"
  | "executing"
  | "completed"
  | "paused"
  | "awaiting_approval";

export interface PlanStep {
  id: string;
  goalId: string;
  description: string;
  tier: StepTier;
  status: StepStatus;
  connectorId?: string;
  rationale?: string;
  result?: unknown;
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface Plan {
  id: string;
  goalId: string;
  steps: PlanStep[];
  status: PlanStatus;
  createdAt: string;
  completedAt?: string;
}

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
  | "goal:submitted";

export interface OrchestratorEvent {
  type: OrchestratorEventType;
  plan?: Plan;
  planId?: string;
  step?: PlanStep;
  stepId?: string;
  error?: string;
  reason?: string;
  timestamp: string;
}

export interface ApprovalRequestEvent extends OrchestratorEvent {
  type: "approval:request";
  planId: string;
  step: PlanStep;
}

export interface GoalSubmittedMessage {
  type: "goal:submitted";
  goalText: string;
}

export interface ApprovalResponseMessage {
  type: "approval:response";
  planId: string;
  stepId: string;
  approved: boolean;
  reason?: string;
}

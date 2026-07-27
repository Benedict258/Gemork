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

// ── Inbox Types ──────────────────────────────────────────────

export type InboxItemType = "approval" | "question" | "notification";
export type InboxItemStatus = "pending" | "resolved" | "cancelled";

export interface InboxApprovalPayload {
  planId: string;
  stepId: string;
  description: string;
  tier: number;
  rationale?: string;
}

export interface InboxQuestionPayload {
  question: string;
  context?: string;
  options?: string[];
}

export interface InboxNotificationPayload {
  message: string;
  level: "info" | "warning" | "error";
}

export interface InboxItem {
  id: string;
  type: InboxItemType;
  status: InboxItemStatus;
  payload: InboxApprovalPayload | InboxQuestionPayload | InboxNotificationPayload;
  createdAt: string;
  resolvedAt?: string;
}

export interface InboxStats {
  pending: number;
  resolved: number;
  cancelled: number;
}

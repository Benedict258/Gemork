import { v4 as uuid } from "uuid";

// ─── Tier Model ──────────────────────────────────────────────
// Tier 1: Read-only operations — fully autonomous, no confirmation
// Tier 2: Reversible writes — autonomous, logged, snapshot-backed
// Tier 3: Critical/irreversible — always requires human approval
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

// ─── Data Structures ─────────────────────────────────────────

export interface Goal {
  id: string;
  text: string;
  createdAt: Date;
}

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
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export interface Plan {
  id: string;
  goalId: string;
  steps: PlanStep[];
  status: PlanStatus;
  createdAt: Date;
  completedAt?: Date;
}

// ─── Factory Functions ───────────────────────────────────────

export function createGoal(text: string): Goal {
  return {
    id: uuid(),
    text,
    createdAt: new Date(),
  };
}

export function createPlanStep(
  goalId: string,
  description: string,
  tier: StepTier,
  opts?: { connectorId?: string; rationale?: string },
): PlanStep {
  return {
    id: uuid(),
    goalId,
    description,
    tier,
    status: "pending",
    connectorId: opts?.connectorId,
    rationale: opts?.rationale,
    createdAt: new Date(),
  };
}

export function createPlan(goalId: string, steps: PlanStep[]): Plan {
  return {
    id: uuid(),
    goalId,
    steps,
    status: "generating",
    createdAt: new Date(),
  };
}

// ─── Plan Helpers ────────────────────────────────────────────

export function getPlanStepById(plan: Plan, stepId: string): PlanStep | undefined {
  return plan.steps.find((s) => s.id === stepId);
}

export function getPendingSteps(plan: Plan): PlanStep[] {
  return plan.steps.filter((s) => s.status === "pending");
}

export function getStepsByTier(plan: Plan, tier: StepTier): PlanStep[] {
  return plan.steps.filter((s) => s.tier === tier);
}

export function isPlanComplete(plan: Plan): boolean {
  return plan.steps.every(
    (s) => s.status === "completed" || s.status === "failed",
  );
}

export function hasFailedSteps(plan: Plan): boolean {
  return plan.steps.some((s) => s.status === "failed");
}

export function getExecutableSteps(plan: Plan): PlanStep[] {
  return plan.steps.filter(
    (s) => s.status === "pending" && s.tier !== 3,
  );
}

export function getApprovalRequiredSteps(plan: Plan): PlanStep[] {
  return plan.steps.filter(
    (s) => s.status === "pending" && s.tier === 3,
  );
}

import { v4 as uuid } from "uuid";

export type StepTier = 1 | 2 | 3;
export type StepStatus = "pending" | "running" | "completed" | "failed" | "awaiting_approval";

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
  createdAt: Date;
  completedAt?: Date;
}

export interface Plan {
  id: string;
  goalId: string;
  steps: PlanStep[];
  status: "generating" | "executing" | "completed" | "paused" | "awaiting_approval";
  createdAt: Date;
}

export function createGoal(text: string): Goal {
  return { id: uuid(), text, createdAt: new Date() };
}

export function createPlanStep(
  goalId: string,
  description: string,
  tier: StepTier,
  connectorId?: string
): PlanStep {
  return {
    id: uuid(),
    goalId,
    description,
    tier,
    status: "pending",
    connectorId,
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

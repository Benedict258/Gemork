import type { Plan, PlanStep, StepTier } from "../orchestrator/plan.js";
import type { Workflow, WorkflowStep } from "./workflow-store.js";

function truncateGoal(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 3) + "...";
}

function isStepUsable(step: PlanStep): boolean {
  if (step.status === "failed") return false;
  if (step.status === "pending") return false;
  return step.status === "completed";
}

export function captureFromPlan(plan: Plan, goal: string, existingStepDescs?: Set<string>): Workflow {
  const seen = existingStepDescs ?? new Set<string>();
  const uniqueSteps: WorkflowStep[] = [];

  for (const step of plan.steps) {
    if (!isStepUsable(step)) continue;
    if (seen.has(step.description)) continue;

    seen.add(step.description);
    uniqueSteps.push({
      description: step.description,
      tier: step.tier as StepTier,
      connectorId: step.connectorId,
      expectedOutcome: step.rationale,
    });
  }

  const name = truncateGoal(goal, 50);

  return {
    id: "",
    name,
    description: `Workflow captured from plan for: ${name}`,
    goal,
    steps: uniqueSteps,
    createdAt: "",
    lastUsed: "",
    useCount: 0,
  };
}

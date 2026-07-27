import { v4 as uuid } from "uuid";
import type { Plan, PlanStep, StepTier } from "../orchestrator/plan.js";
import type { Workflow } from "./workflow-store.js";
import { WorkflowStore } from "./workflow-store.js";
import { createGoal, createPlan, createPlanStep } from "../orchestrator/plan.js";

export async function replayWorkflow(
  projectId: string,
  workflowId: string,
): Promise<{ plan: Plan; goalText: string } | null> {
  const store = new WorkflowStore();
  const workflow = await store.getWorkflow(projectId, workflowId);
  if (!workflow) return null;

  await store.incrementUseCount(projectId, workflowId);

  const goal = createGoal(workflow.goal);
  const steps: PlanStep[] = workflow.steps.map((ws) =>
    createPlanStep(goal.id, ws.description, ws.tier as StepTier, {
      connectorId: ws.connectorId,
      rationale: ws.expectedOutcome,
    }),
  );

  const plan = createPlan(goal.id, steps);

  return { plan, goalText: workflow.goal };
}

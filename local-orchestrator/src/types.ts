// Backward-compatible re-exports from the new orchestrator/plan module.
// New code should import from "./orchestrator/plan.js" directly.

export type { Goal, Plan, PlanStep, StepStatus, StepTier, PlanStatus } from "./orchestrator/plan.js";
export { createGoal, createPlan, createPlanStep } from "./orchestrator/plan.js";

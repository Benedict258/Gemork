import { EventEmitter } from "events";
import { createGoal, createPlan, createPlanStep, type Goal, type Plan, type PlanStep } from "./types.js";

export class GemorkOrchestrator extends EventEmitter {
  private plans: Map<string, Plan> = new Map();
  private goals: Map<string, Goal> = new Map();

  async submitGoal(text: string): Promise<Plan> {
    const goal = createGoal(text);
    this.goals.set(goal.id, goal);

    const steps = await this.decomposeIntoSteps(goal);
    const plan = createPlan(goal.id, steps);
    this.plans.set(plan.id, plan);

    this.emit("plan:created", plan);
    return plan;
  }

  async approveStep(planId: string, stepId: string): Promise<void> {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(`Plan ${planId} not found`);

    const step = plan.steps.find((s) => s.id === stepId);
    if (!step) throw new Error(`Step ${stepId} not found`);

    step.status = "pending";
    this.emit("step:approved", { planId, stepId });
  }

  async rejectStep(planId: string, stepId: string): Promise<void> {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(`Plan ${planId} not found`);

    const step = plan.steps.find((s) => s.id === stepId);
    if (!step) throw new Error(`Step ${stepId} not found`);

    step.status = "failed";
    this.emit("step:rejected", { planId, stepId });
  }

  getPlan(planId: string): Plan | undefined {
    return this.plans.get(planId);
  }

  getAllPlans(): Plan[] {
    return Array.from(this.plans.values());
  }

  private async decomposeIntoSteps(goal: Goal): Promise<PlanStep[]> {
    // TODO: Integrate Gemma 4 for plan generation
    return [
      createPlanStep(goal.id, `Analyzing goal: ${goal.text}`, 1),
      createPlanStep(goal.id, "Research and gather context", 1),
      createPlanStep(goal.id, "Draft deliverable", 2),
      createPlanStep(goal.id, "Review and finalize", 2),
    ];
  }
}

import { describe, it, expect } from "vitest";
import {
  createGoal,
  createPlan,
  createPlanStep,
  getPlanStepById,
  getPendingSteps,
  getStepsByTier,
  isPlanComplete,
  hasFailedSteps,
  getExecutableSteps,
  getApprovalRequiredSteps,
  type Plan,
  type PlanStep,
} from "../../src/orchestrator/plan.js";

describe("orchestrator/plan", () => {
  describe("createGoal", () => {
    it("produces a valid goal object with id, text, and timestamp", () => {
      const goal = createGoal("Build a new feature");

      expect(goal).toHaveProperty("id");
      expect(typeof goal.id).toBe("string");
      expect(goal.id.length).toBeGreaterThan(0);
      expect(goal.text).toBe("Build a new feature");
      expect(goal.createdAt).toBeInstanceOf(Date);
    });

    it("creates unique ids for different goals", () => {
      const g1 = createGoal("Goal 1");
      const g2 = createGoal("Goal 2");
      expect(g1.id).not.toBe(g2.id);
    });
  });

  describe("createPlanStep", () => {
    it("produces a valid step with correct tier", () => {
      const goal = createGoal("Test");
      const step = createPlanStep(goal.id, "Read files", 1);

      expect(step).toHaveProperty("id");
      expect(step.goalId).toBe(goal.id);
      expect(step.description).toBe("Read files");
      expect(step.tier).toBe(1);
      expect(step.status).toBe("pending");
      expect(step.createdAt).toBeInstanceOf(Date);
    });

    it("accepts tier 2 with connector and rationale", () => {
      const step = createPlanStep("g1", "Write file", 2, {
        connectorId: "filesystem",
        rationale: "Reversible write",
      });

      expect(step.tier).toBe(2);
      expect(step.connectorId).toBe("filesystem");
      expect(step.rationale).toBe("Reversible write");
    });

    it("accepts tier 3", () => {
      const step = createPlanStep("g1", "Delete file", 3);
      expect(step.tier).toBe(3);
    });
  });

  describe("createPlan", () => {
    it("assembles steps into a plan with generating status", () => {
      const goal = createGoal("Test");
      const steps = [
        createPlanStep(goal.id, "Step 1", 1),
        createPlanStep(goal.id, "Step 2", 2),
      ];
      const plan = createPlan(goal.id, steps);

      expect(plan).toHaveProperty("id");
      expect(plan.goalId).toBe(goal.id);
      expect(plan.steps).toHaveLength(2);
      expect(plan.status).toBe("generating");
      expect(plan.createdAt).toBeInstanceOf(Date);
    });
  });

  describe("plan helpers", () => {
    function makePlan(): Plan {
      const goal = createGoal("Test");
      const steps = [
        createPlanStep(goal.id, "Read files", 1),
        createPlanStep(goal.id, "Write file", 2),
        createPlanStep(goal.id, "Delete file", 3),
      ];
      return createPlan(goal.id, steps);
    }

    it("getPlanStepById finds the correct step", () => {
      const plan = makePlan();
      const step = plan.steps[0];
      expect(getPlanStepById(plan, step.id)).toBe(step);
      expect(getPlanStepById(plan, "nonexistent")).toBeUndefined();
    });

    it("getPendingSteps returns only pending steps", () => {
      const plan = makePlan();
      const pending = getPendingSteps(plan);
      expect(pending).toHaveLength(3);
      plan.steps[0].status = "completed";
      expect(getPendingSteps(plan)).toHaveLength(2);
    });

    it("getStepsByTier filters correctly", () => {
      const plan = makePlan();
      expect(getStepsByTier(plan, 1)).toHaveLength(1);
      expect(getStepsByTier(plan, 2)).toHaveLength(1);
      expect(getStepsByTier(plan, 3)).toHaveLength(1);
    });

    it("isPlanComplete returns true when all steps are done", () => {
      const plan = makePlan();
      expect(isPlanComplete(plan)).toBe(false);
      plan.steps.forEach((s) => (s.status = "completed"));
      expect(isPlanComplete(plan)).toBe(true);
    });

    it("isPlanComplete returns true when some steps failed", () => {
      const plan = makePlan();
      plan.steps[0].status = "completed";
      plan.steps[1].status = "failed";
      plan.steps[2].status = "completed";
      expect(isPlanComplete(plan)).toBe(true);
    });

    it("hasFailedSteps detects failures", () => {
      const plan = makePlan();
      expect(hasFailedSteps(plan)).toBe(false);
      plan.steps[1].status = "failed";
      expect(hasFailedSteps(plan)).toBe(true);
    });

    it("getExecutableSteps excludes tier 3", () => {
      const plan = makePlan();
      const executable = getExecutableSteps(plan);
      expect(executable).toHaveLength(2);
      executable.forEach((s) => expect(s.tier).not.toBe(3));
    });

    it("getApprovalRequiredSteps returns only tier 3 pending", () => {
      const plan = makePlan();
      const approval = getApprovalRequiredSteps(plan);
      expect(approval).toHaveLength(1);
      expect(approval[0].tier).toBe(3);
    });
  });
});

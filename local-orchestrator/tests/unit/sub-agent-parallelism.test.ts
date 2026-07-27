import { describe, it, expect, vi, beforeEach } from "vitest";
import { SubAgentCoordinator } from "../../src/orchestrator/sub-agent-coordinator.js";
import { createGoal, createPlan, createPlanStep } from "../../src/orchestrator/plan.js";
import type { Plan } from "../../src/orchestrator/plan.js";

describe("SubAgentCoordinator — parallel execution", () => {
  let coordinator: SubAgentCoordinator;

  beforeEach(() => {
    coordinator = new SubAgentCoordinator({ maxConcurrency: 3 });
  });

  it("processQueue starts up to maxConcurrency tasks simultaneously", () => {
    const goal = createGoal("Test parallel execution");
    const steps = [
      createPlanStep(goal.id, "Task A", 1),
      createPlanStep(goal.id, "Task B", 1),
      createPlanStep(goal.id, "Task C", 1),
      createPlanStep(goal.id, "Task D", 1),
    ];
    const plan = createPlan(goal.id, steps);

    for (const step of steps) {
      coordinator.enqueueStep(plan, step);
    }

    expect(coordinator.getQueuedCount()).toBe(4);
    expect(coordinator.getActiveCount()).toBe(0);

    const started = coordinator.processQueue();

    expect(started).toHaveLength(3);
    expect(coordinator.getActiveCount()).toBe(3);
    expect(coordinator.getQueuedCount()).toBe(1);

    for (const task of started) {
      expect(task.status).toBe("running");
      expect(task.startedAt).toBeInstanceOf(Date);
    }
  });

  it("completing a running task frees a slot for queued tasks", () => {
    const goal = createGoal("Test slot reclamation");
    const steps = [
      createPlanStep(goal.id, "A", 1),
      createPlanStep(goal.id, "B", 1),
      createPlanStep(goal.id, "C", 1),
      createPlanStep(goal.id, "D", 1),
    ];
    const plan = createPlan(goal.id, steps);

    const enqueued = steps.map((step) => coordinator.enqueueStep(plan, step));
    const started = coordinator.processQueue();
    expect(coordinator.getActiveCount()).toBe(3);

    const firstRunning = started[0];
    coordinator.completeTask(firstRunning.id, { done: true });

    expect(coordinator.getActiveCount()).toBe(2);

    const moreStarted = coordinator.processQueue();
    expect(moreStarted).toHaveLength(1);
    expect(coordinator.getActiveCount()).toBe(3);
    expect(coordinator.getQueuedCount()).toBe(0);
  });

  it("aggregatePlanResults collects results from parallel tasks", () => {
    const goal = createGoal("Test result aggregation");
    const steps = [
      createPlanStep(goal.id, "A", 1),
      createPlanStep(goal.id, "B", 1),
    ];
    const plan = createPlan(goal.id, steps);

    for (const step of steps) {
      coordinator.enqueueStep(plan, step);
    }

    const started = coordinator.processQueue();
    coordinator.completeTask(started[0].id, { output: "result A" });
    coordinator.completeTask(started[1].id, { output: "result B" });

    const results = coordinator.aggregatePlanResults(plan.id);
    expect(results.size).toBe(2);

    for (const [stepId, result] of results) {
      expect(result.success).toBe(true);
      expect(result.result).toBeDefined();
    }
  });

  it("all parallel tasks complete within tight timing window", async () => {
    const goal = createGoal("Timing test");
    const steps = [
      createPlanStep(goal.id, "Fast A", 1),
      createPlanStep(goal.id, "Fast B", 1),
      createPlanStep(goal.id, "Fast C", 1),
    ];
    const plan = createPlan(goal.id, steps);

    for (const step of steps) {
      coordinator.enqueueStep(plan, step);
    }

    const started = coordinator.processQueue();
    expect(started).toHaveLength(3);

    const start = Date.now();

    // Simulate parallel async work (like real LLM calls would be)
    const workPromises = started.map((task) =>
      new Promise<void>((resolve) => {
        setTimeout(() => {
          coordinator.completeTask(task.id, { done: true });
          resolve();
        }, 100 + Math.random() * 50);
      }),
    );

    await Promise.all(workPromises);

    const elapsed = Date.now() - start;
    const results = coordinator.aggregatePlanResults(plan.id);

    // All 3 should be completed
    expect(results.size).toBe(3);
    for (const [, result] of results) {
      expect(result.success).toBe(true);
    }

    // Elapsed should be ~150ms (max individual), NOT ~450ms (3x sequential)
    // This proves tasks ran in parallel
    expect(elapsed).toBeLessThan(300);
  });
});

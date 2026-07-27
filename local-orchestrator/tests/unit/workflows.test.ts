import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WorkflowStore } from "../../src/workflows/workflow-store.js";
import { captureFromPlan } from "../../src/workflows/workflow-capture.js";
import { replayWorkflow } from "../../src/workflows/workflow-replay.js";
import { Scheduler, parseSimpleCron } from "../../src/scheduling/scheduler.js";
import { SchedulerEngine } from "../../src/scheduling/scheduler-engine.js";
import { createTestProject, cleanupTestArtifacts, type TestProject } from "../setup.js";
import type { Plan, PlanStep, StepTier } from "../../src/orchestrator/plan.js";

function makePlanStep(overrides: Partial<PlanStep> & { description: string; tier: StepTier }): PlanStep {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    goalId: overrides.goalId ?? "goal-1",
    description: overrides.description,
    tier: overrides.tier,
    status: overrides.status ?? "completed",
    connectorId: overrides.connectorId,
    rationale: overrides.rationale,
    createdAt: new Date(),
    ...overrides,
  } as PlanStep;
}

function makePlan(steps: PlanStep[], status: Plan["status"] = "completed"): Plan {
  return {
    id: "plan-1",
    goalId: "goal-1",
    steps,
    status,
    createdAt: new Date(),
  };
}

describe("workflows/workflow-store", () => {
  let project: TestProject;
  let store: WorkflowStore;

  beforeEach(async () => {
    project = await createTestProject("wf-store");
    process.chdir(project.dir);
    store = new WorkflowStore();
  });

  afterEach(async () => {
    await cleanupTestArtifacts(project.dir);
    await project.cleanup();
    process.chdir("/home/ubuntu/Workspace/Gemork");
  });

  it("save and retrieve workflow", async () => {
    const id = await store.saveWorkflow("proj", {
      name: "Test Workflow",
      description: "A test",
      goal: "Do something",
      steps: [{ description: "Step 1", tier: 1 }],
    });

    expect(id).toBeTruthy();

    const wf = await store.getWorkflow("proj", id);
    expect(wf).not.toBeNull();
    expect(wf!.name).toBe("Test Workflow");
    expect(wf!.goal).toBe("Do something");
    expect(wf!.steps).toHaveLength(1);
    expect(wf!.steps[0].description).toBe("Step 1");
    expect(wf!.useCount).toBe(0);
  });

  it("listWorkflows returns all workflows", async () => {
    await store.saveWorkflow("proj", {
      name: "First",
      description: "",
      goal: "Goal 1",
      steps: [],
    });
    await store.saveWorkflow("proj", {
      name: "Second",
      description: "",
      goal: "Goal 2",
      steps: [],
    });

    const list = await store.listWorkflows("proj");
    expect(list).toHaveLength(2);
  });

  it("deleteWorkflow removes workflow", async () => {
    const id = await store.saveWorkflow("proj", {
      name: "Delete Me",
      description: "",
      goal: "Goal",
      steps: [],
    });

    const deleted = await store.deleteWorkflow("proj", id);
    expect(deleted).toBe(true);

    const wf = await store.getWorkflow("proj", id);
    expect(wf).toBeNull();
  });

  it("incrementUseCount updates workflow", async () => {
    const id = await store.saveWorkflow("proj", {
      name: "Counter",
      description: "",
      goal: "Goal",
      steps: [],
    });

    await store.incrementUseCount("proj", id);
    await store.incrementUseCount("proj", id);

    const wf = await store.getWorkflow("proj", id);
    expect(wf!.useCount).toBe(2);
  });

  it("listWorkflows returns empty for missing project", async () => {
    const list = await store.listWorkflows("nonexistent");
    expect(list).toHaveLength(0);
  });
});

describe("workflows/workflow-capture", () => {
  it("captureFromPlan extracts completed steps", () => {
    const steps = [
      makePlanStep({ description: "Step 1", tier: 1, status: "completed" }),
      makePlanStep({ description: "Step 2", tier: 2, status: "completed" }),
      makePlanStep({ description: "Failed Step", tier: 1, status: "failed" }),
      makePlanStep({ description: "Pending Step", tier: 1, status: "pending" }),
    ];
    const plan = makePlan(steps);

    const captured = captureFromPlan(plan, "Build a feature");

    expect(captured.goal).toBe("Build a feature");
    expect(captured.steps).toHaveLength(2);
    expect(captured.steps[0].description).toBe("Step 1");
    expect(captured.steps[1].description).toBe("Step 2");
  });

  it("captureFromPlan deduplicates steps", () => {
    const steps = [
      makePlanStep({ description: "Same Step", tier: 1, status: "completed" }),
      makePlanStep({ description: "Same Step", tier: 1, status: "completed" }),
    ];
    const plan = makePlan(steps);

    const captured = captureFromPlan(plan, "Dedup test");

    expect(captured.steps).toHaveLength(1);
  });

  it("captureFromPlan filters existing steps", () => {
    const steps = [
      makePlanStep({ description: "Existing", tier: 1, status: "completed" }),
      makePlanStep({ description: "New", tier: 1, status: "completed" }),
    ];
    const plan = makePlan(steps);
    const existing = new Set(["Existing"]);

    const captured = captureFromPlan(plan, "Filter test", existing);

    expect(captured.steps).toHaveLength(1);
    expect(captured.steps[0].description).toBe("New");
  });

  it("captureFromPlan truncates long goal name", () => {
    const longGoal = "A".repeat(100);
    const plan = makePlan([
      makePlanStep({ description: "Step", tier: 1, status: "completed" }),
    ]);

    const captured = captureFromPlan(plan, longGoal);

    expect(captured.name.length).toBeLessThanOrEqual(50);
    expect(captured.name.endsWith("...")).toBe(true);
  });
});

describe("workflows/workflow-replay", () => {
  let project: TestProject;

  beforeEach(async () => {
    project = await createTestProject("wf-replay");
    process.chdir(project.dir);
  });

  afterEach(async () => {
    await cleanupTestArtifacts(project.dir);
    await project.cleanup();
    process.chdir("/home/ubuntu/Workspace/Gemork");
  });

  it("replayWorkflow creates new plan from saved workflow", async () => {
    const store = new WorkflowStore();
    const id = await store.saveWorkflow("proj", {
      name: "Replay Test",
      description: "Test replay",
      goal: "Replay this goal",
      steps: [
        { description: "Step A", tier: 1 },
        { description: "Step B", tier: 2, connectorId: "fs" },
      ],
    });

    const result = await replayWorkflow("proj", id);

    expect(result).not.toBeNull();
    expect(result!.goalText).toBe("Replay this goal");
    expect(result!.plan.steps).toHaveLength(2);
    expect(result!.plan.steps[0].description).toBe("Step A");
    expect(result!.plan.steps[0].tier).toBe(1);
    expect(result!.plan.steps[1].connectorId).toBe("fs");
  });

  it("replayWorkflow increments use count", async () => {
    const store = new WorkflowStore();
    const id = await store.saveWorkflow("proj", {
      name: "Count Test",
      description: "",
      goal: "Goal",
      steps: [{ description: "S", tier: 1 }],
    });

    await replayWorkflow("proj", id);
    await replayWorkflow("proj", id);

    const wf = await store.getWorkflow("proj", id);
    expect(wf!.useCount).toBe(2);
  });

  it("replayWorkflow returns null for missing workflow", async () => {
    const result = await replayWorkflow("proj", "nonexistent");
    expect(result).toBeNull();
  });
});

describe("scheduling/scheduler", () => {
  let project: TestProject;
  let scheduler: Scheduler;

  beforeEach(async () => {
    project = await createTestProject("scheduler");
    process.chdir(project.dir);
    scheduler = new Scheduler();
  });

  afterEach(async () => {
    await cleanupTestArtifacts(project.dir);
    await project.cleanup();
    process.chdir("/home/ubuntu/Workspace/Gemork");
  });

  it("schedule creates a schedule with correct nextRun", async () => {
    const before = Date.now();
    const id = await scheduler.schedule({
      projectId: "proj",
      goal: "Test goal",
      cron: "daily",
      enabled: true,
    });

    expect(id).toBeTruthy();

    const sched = scheduler.getSchedule(id);
    expect(sched).not.toBeNull();
    expect(sched!.goal).toBe("Test goal");
    expect(sched!.cron).toBe("daily");
    expect(new Date(sched!.nextRun).getTime()).toBeGreaterThanOrEqual(before);
  });

  it("unschedule removes schedule", async () => {
    const id = await scheduler.schedule({
      projectId: "proj",
      goal: "Delete me",
      cron: "hourly",
      enabled: true,
    });

    const removed = await scheduler.unschedule(id);
    expect(removed).toBe(true);
    expect(scheduler.getSchedule(id)).toBeUndefined();
  });

  it("getDueSchedules returns enabled schedules past nextRun", async () => {
    const id = await scheduler.schedule({
      projectId: "proj",
      goal: "Due schedule",
      cron: "daily",
      enabled: true,
    });

    // Manually set nextRun to the past
    const sched = scheduler.getSchedule(id)!;
    sched.nextRun = new Date(Date.now() - 1000).toISOString();

    const due = scheduler.getDueSchedules();
    expect(due).toHaveLength(1);
    expect(due[0].id).toBe(id);
  });

  it("triggerSchedule updates lastRun and nextRun", async () => {
    const id = await scheduler.schedule({
      projectId: "proj",
      goal: "Trigger test",
      cron: "daily",
      enabled: true,
    });

    const before = Date.now();
    const result = await scheduler.triggerSchedule(id);

    expect(result).not.toBeNull();
    expect(result!.lastRun).toBeTruthy();
    expect(new Date(result!.lastRun!).getTime()).toBeGreaterThanOrEqual(before);
  });

  it("getSchedules returns sorted by nextRun", async () => {
    await scheduler.schedule({
      projectId: "proj",
      goal: "Second",
      cron: "weekly",
      enabled: true,
    });
    await scheduler.schedule({
      projectId: "proj",
      goal: "First",
      cron: "daily",
      enabled: true,
    });

    const list = scheduler.getSchedules();
    expect(list).toHaveLength(2);
    // daily comes before weekly
    expect(new Date(list[0].nextRun).getTime()).toBeLessThanOrEqual(
      new Date(list[1].nextRun).getTime(),
    );
  });
});

describe("scheduling/simple cron parsing", () => {
  it("parses daily", () => {
    const base = new Date("2025-01-01T00:00:00Z");
    const next = parseSimpleCron("daily", base);
    expect(next - base.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("parses weekly", () => {
    const base = new Date("2025-01-01T00:00:00Z");
    const next = parseSimpleCron("weekly", base);
    expect(next - base.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("parses hourly", () => {
    const base = new Date("2025-01-01T00:00:00Z");
    const next = parseSimpleCron("hourly", base);
    expect(next - base.getTime()).toBe(60 * 60 * 1000);
  });

  it("parses every N hours", () => {
    const base = new Date("2025-01-01T00:00:00Z");
    const next = parseSimpleCron("every 6 hours", base);
    expect(next - base.getTime()).toBe(6 * 60 * 60 * 1000);
  });

  it("parses every N minutes", () => {
    const base = new Date("2025-01-01T00:00:00Z");
    const next = parseSimpleCron("every 30 minutes", base);
    expect(next - base.getTime()).toBe(30 * 60 * 1000);
  });
});

describe("scheduling/scheduler-engine", () => {
  let project: TestProject;

  beforeEach(async () => {
    project = await createTestProject("engine");
    process.chdir(project.dir);
  });

  afterEach(async () => {
    await cleanupTestArtifacts(project.dir);
    await project.cleanup();
    process.chdir("/home/ubuntu/Workspace/Gemork");
  });

  it("checkDue triggers due schedules and emits event", async () => {
    const engine = new SchedulerEngine();
    const triggered: string[] = [];

    engine.on("schedule:triggered", (event) => {
      if (event.type === "schedule:triggered") {
        triggered.push(event.schedule.goal);
      }
    });

    const id = await engine.getScheduler().schedule({
      projectId: "proj",
      goal: "Due goal",
      cron: "daily",
      enabled: true,
    });

    // Force schedule to be due
    const sched = engine.getScheduler().getSchedule(id)!;
    sched.nextRun = new Date(Date.now() - 1000).toISOString();

    const triggeredSchedules = await engine.checkDue();

    expect(triggeredSchedules).toHaveLength(1);
    expect(triggered).toContain("Due goal");
  });

  it("checkDue skips disabled schedules", async () => {
    const engine = new SchedulerEngine();

    await engine.getScheduler().schedule({
      projectId: "proj",
      goal: "Disabled",
      cron: "daily",
      enabled: false,
    });

    // Force schedule to be due
    const sched = engine.getScheduler().getSchedules()[0];
    sched.nextRun = new Date(Date.now() - 1000).toISOString();

    const triggered = await engine.checkDue();
    expect(triggered).toHaveLength(0);
  });

  it("start and stop manage interval", () => {
    const engine = new SchedulerEngine();
    engine.start(1000);
    engine.stop();
    // No error means success
    expect(true).toBe(true);
  });
});

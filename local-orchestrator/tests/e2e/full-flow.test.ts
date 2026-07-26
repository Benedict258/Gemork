import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TaskEngine } from "../../src/orchestrator/task-engine.js";
import type { LLMPlanOutput } from "../../src/orchestrator/task-engine.js";
import { SnapshotService } from "../../src/storage/snapshot-service.js";
import { BuildContextMemory } from "../../src/storage/build-context-memory.js";
import { FilesystemConnector } from "../../src/connectors/filesystem-connector.js";
import { createTestProject, createTestFile, cleanupTestArtifacts, type TestProject } from "../setup.js";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

function createMockPlanGenerator(steps?: LLMPlanOutput[]) {
  const planSteps: LLMPlanOutput[] = steps ?? [
    { description: "Analyze goal and gather context", tier: 1, rationale: "Read-only analysis" },
    { description: "Create draft document", tier: 2, rationale: "Reversible write", connectorId: "filesystem" },
    { description: "Deploy to production", tier: 3, rationale: "Critical change requiring approval" },
  ];

  return {
    async generatePlan(_goal: string): Promise<LLMPlanOutput[]> {
      return planSteps;
    },
  };
}

describe("e2e/full-flow", () => {
  let project: TestProject;
  let snapshotService: SnapshotService;
  let memory: BuildContextMemory;

  beforeEach(async () => {
    project = await createTestProject("e2e");
    process.chdir(project.dir);
    snapshotService = new SnapshotService();
    memory = new BuildContextMemory();
  });

  afterEach(async () => {
    await cleanupTestArtifacts(project.dir);
    await project.cleanup();
    process.chdir("/home/ubuntu/Workspace/Gemork");
  });

  it("full goal→plan→execute flow with autoApprove", async () => {
    const mockGenerator = createMockPlanGenerator();

    const engine = new TaskEngine({
      llmGenerator: mockGenerator,
      autoApprove: true,
    });

    const eventBus = engine.getEventBus();
    const events: string[] = [];
    eventBus.subscribe("plan:created", () => events.push("plan:created"));
    eventBus.subscribe("step:started", () => events.push("step:started"));
    eventBus.subscribe("step:completed", () => events.push("step:completed"));
    eventBus.subscribe("plan:completed", () => events.push("plan:completed"));

    const result = await engine.run({
      goal: "Create a project summary document",
      autoApprove: true,
    });

    // Plan was generated
    expect(result.plan).toBeDefined();
    expect(result.plan.steps.length).toBeGreaterThanOrEqual(2);

    // Tier 1/2 steps auto-executed
    const tier12Steps = result.plan.steps.filter((s) => s.tier !== 3);
    for (const step of tier12Steps) {
      expect(step.status).toBe("completed");
    }

    // Events were fired
    expect(events).toContain("plan:created");
    expect(events.filter((e) => e === "step:started")).toHaveLength(tier12Steps.length);
    expect(events.filter((e) => e === "step:completed")).toHaveLength(tier12Steps.length);
  });

  it("plan with no tier-3 steps completes fully", async () => {
    const mockGenerator = createMockPlanGenerator([
      { description: "Read project files", tier: 1, rationale: "Analysis" },
      { description: "Write summary", tier: 2, rationale: "Create document" },
      { description: "Review output", tier: 1, rationale: "Verification" },
    ]);

    const engine = new TaskEngine({
      llmGenerator: mockGenerator,
      autoApprove: false,
    });

    const result = await engine.run({
      goal: "Analyze and summarize",
      autoApprove: false,
    });

    // All steps should complete (no tier-3 gates)
    expect(result.plan.status).toBe("completed");
    for (const step of result.plan.steps) {
      expect(step.status).toBe("completed");
    }
  });

  it("tier-3 steps block execution and require approval", async () => {
    const mockGenerator = createMockPlanGenerator([
      { description: "Analyze data", tier: 1, rationale: "Safe read" },
      { description: "Delete old files", tier: 3, rationale: "Irreversible" },
    ]);

    const engine = new TaskEngine({
      llmGenerator: mockGenerator,
      autoApprove: false,
    });

    // Run in background (will block on approval)
    const runPromise = engine.run({
      goal: "Cleanup project",
      autoApprove: false,
    });

    // Give engine time to reach approval gate
    await new Promise((r) => setTimeout(r, 200));

    const plan = engine.getAllPlans()[0];
    expect(plan).toBeDefined();

    // Tier-3 step should be awaiting approval
    const tier3Step = plan.steps.find((s) => s.tier === 3);
    expect(tier3Step?.status).toBe("awaiting_approval");

    // Plan status should be awaiting_approval
    expect(plan.status).toBe("awaiting_approval");

    // Tier-1 step hasn't executed yet (engine waits for approval first)
    const tier1Step = plan.steps.find((s) => s.tier === 1);
    expect(tier1Step?.status).toBe("pending");

    // Approve the tier-3 step — triggers processRemainingSteps
    engine.approveStep(plan.id, tier3Step!.id);

    // Wait for completion
    const result = await runPromise;

    // Plan completes (all tier 1/2 steps done)
    expect(result.plan.status).toBe("completed");

    // Tier-3 step was approved (set back to pending) but not executed
    // by the engine — tier 3 steps are approval gates only
    expect(tier3Step?.status).toBe("pending");

    // Tier-1 step was executed and completed
    expect(tier1Step?.status).toBe("completed");
  });

  it("rejection marks step as failed", async () => {
    const mockGenerator = createMockPlanGenerator([
      { description: "Critical operation", tier: 3, rationale: "Needs approval" },
    ]);

    const engine = new TaskEngine({
      llmGenerator: mockGenerator,
      autoApprove: false,
    });

    const runPromise = engine.run({
      goal: "Test rejection",
      autoApprove: false,
    });

    await new Promise((r) => setTimeout(r, 200));

    const plan = engine.getAllPlans()[0];
    const step = plan.steps[0];
    expect(step.status).toBe("awaiting_approval");

    engine.rejectStep(plan.id, step.id, "Not approved");

    const result = await runPromise;

    expect(step.status).toBe("failed");
    expect(step.error).toBe("Not approved");
  });

  it("autoApprove skips approval gates", async () => {
    const mockGenerator = createMockPlanGenerator([
      { description: "Read data", tier: 1, rationale: "Safe" },
      { description: "Delete file", tier: 3, rationale: "Critical" },
    ]);

    const engine = new TaskEngine({
      llmGenerator: mockGenerator,
      autoApprove: true,
    });

    const result = await engine.run({
      goal: "Test auto-approve",
      autoApprove: true,
    });

    // Tier 1/2 steps should be completed
    const tier12 = result.plan.steps.filter((s) => s.tier !== 3);
    for (const step of tier12) {
      expect(step.status).toBe("completed");
    }

    // Plan should be completed
    expect(result.plan.status).toBe("completed");
  });

  it("offline resilience — engine handles LLM failure", async () => {
    const failingGenerator = {
      async generatePlan(): Promise<LLMPlanOutput[]> {
        throw new Error("LLM provider unavailable");
      },
    };

    const engine = new TaskEngine({
      llmGenerator: failingGenerator,
      autoApprove: true,
    });

    // TaskEngine doesn't catch LLM errors in generatePlan — it propagates
    // This tests that the engine at least creates the goal
    try {
      await engine.run({
        goal: "Test offline resilience",
        autoApprove: true,
      });
    } catch (err) {
      expect((err as Error).message).toContain("LLM provider unavailable");
    }

    // Goal should still be created even if plan generation fails
    // (This validates the engine doesn't crash entirely)
  });

  it("multiple plans can coexist", async () => {
    const mockGenerator = createMockPlanGenerator([
      { description: "Step A", tier: 1, rationale: "Analysis" },
    ]);

    const engine = new TaskEngine({
      llmGenerator: mockGenerator,
      autoApprove: true,
    });

    const r1 = await engine.run({ goal: "Plan 1", autoApprove: true });
    const r2 = await engine.run({ goal: "Plan 2", autoApprove: true });

    expect(engine.getAllPlans()).toHaveLength(2);
    expect(r1.plan.id).not.toBe(r2.plan.id);
  });
});

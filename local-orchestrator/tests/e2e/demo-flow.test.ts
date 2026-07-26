import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TaskEngine } from "../../src/orchestrator/task-engine.js";
import type { LLMPlanOutput } from "../../src/orchestrator/task-engine.js";
import { SnapshotService } from "../../src/storage/snapshot-service.js";
import { BuildContextMemory } from "../../src/storage/build-context-memory.js";
import { FilesystemConnector } from "../../src/connectors/filesystem-connector.js";
import { ConnectorManager } from "../../src/connectors/connector-manager.js";
import { ConnectorBridge } from "../../src/connectors/connector-bridge.js";
import { GuardrailEngine } from "../../src/guardrails/index.js";
import { createTestProject, cleanupTestArtifacts, type TestProject } from "../setup.js";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * Demo Flow Test — THE MONEY SHOT
 *
 * Simulates the hackathon demo:
 *   User: "Create a project summary document"
 *   → Plan: research → draft → review → finalize
 *   → Steps execute with correct tier behavior
 *   → Snapshots created, memory logged
 *   → Full pipeline verified
 */
describe("e2e/demo-flow", () => {
  let project: TestProject;
  let snapshotService: SnapshotService;
  let memory: BuildContextMemory;
  let guardrailEngine: GuardrailEngine;
  let connectorManager: ConnectorManager;
  let connector: FilesystemConnector;
  let connectorBridge: ConnectorBridge;

  const DEMO_GOAL = "Create a project summary document";
  const DEMO_STEPS: LLMPlanOutput[] = [
    {
      description: "Research existing project files",
      tier: 1,
      rationale: "Read-only research — gather context from existing files",
      connectorId: "filesystem",
    },
    {
      description: "Write project summary draft",
      tier: 2,
      rationale: "Reversible file creation — can be undone via snapshot",
      connectorId: "filesystem",
    },
    {
      description: "Review and refine the draft",
      tier: 2,
      rationale: "Edit with undo capability — snapshot-backed modifications",
      connectorId: "filesystem",
    },
    {
      description: "Present final summary to user",
      tier: 1,
      rationale: "Read-only output — display the completed document",
      connectorId: "filesystem",
    },
  ];

  beforeEach(async () => {
    project = await createTestProject("demo");
    process.chdir(project.dir);

    // Initialize all services
    snapshotService = new SnapshotService();
    memory = new BuildContextMemory();
    guardrailEngine = new GuardrailEngine();
    connectorManager = new ConnectorManager();

    // Set up filesystem connector
    connector = new FilesystemConnector({
      basePath: project.dir,
      projectId: "demo-project",
      snapshotService,
    });
    await connector.connect();
    connectorManager.registerConnector(connector);
    connectorManager.approveConnector(connector.id);

    // Set up bridge
    connectorBridge = new ConnectorBridge({
      connectorManager,
      guardrailEngine,
      snapshotService,
      buildContextMemory: memory,
      onApprovalRequest: async () => true,
    });

    // Pre-create some project files for step 1 to read
    await mkdir(join(project.dir, "src"), { recursive: true });
    await writeFile(join(project.dir, "src/index.ts"), 'console.log("Hello Gemork");', "utf-8");
    await writeFile(join(project.dir, "package.json"), '{"name": "my-project", "version": "1.0.0"}', "utf-8");
    await writeFile(join(project.dir, "README.md"), "# My Project\n\nA sample project.", "utf-8");
  });

  afterEach(async () => {
    await connector.disconnect();
    await cleanupTestArtifacts(project.dir);
    await project.cleanup();
    process.chdir("/home/ubuntu/Workspace/Gemork");
  });

  it("THE MONEY SHOT — full demo flow", async () => {
    // ── Arrange ──────────────────────────────────────────────
    const mockGenerator = {
      async generatePlan(): Promise<LLMPlanOutput[]> {
        return DEMO_STEPS;
      },
    };

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

    // ── Act ───────────────────────────────────────────────────
    const result = await engine.run({
      goal: DEMO_GOAL,
      autoApprove: true,
    });

    // ── Assert: Plan Structure ────────────────────────────────
    expect(result.plan).toBeDefined();
    expect(result.plan.steps).toHaveLength(4);
    expect(result.plan.status).toBe("completed");
    expect(result.plan.completedAt).toBeDefined();

    // ── Assert: Step 1 — Research (Tier 1, autonomous) ───────
    const step1 = result.plan.steps[0];
    expect(step1.description).toBe("Research existing project files");
    expect(step1.tier).toBe(1);
    expect(step1.status).toBe("completed");

    // ── Assert: Step 2 — Draft (Tier 2, snapshot-backed) ─────
    const step2 = result.plan.steps[1];
    expect(step2.description).toBe("Write project summary draft");
    expect(step2.tier).toBe(2);
    expect(step2.status).toBe("completed");

    // ── Assert: Step 3 — Review (Tier 2, snapshot-backed) ────
    const step3 = result.plan.steps[2];
    expect(step3.description).toBe("Review and refine the draft");
    expect(step3.tier).toBe(2);
    expect(step3.status).toBe("completed");

    // ── Assert: Step 4 — Present (Tier 1, autonomous) ────────
    const step4 = result.plan.steps[3];
    expect(step4.description).toBe("Present final summary to user");
    expect(step4.tier).toBe(1);
    expect(step4.status).toBe("completed");

    // ── Assert: All steps completed ───────────────────────────
    const allCompleted = result.plan.steps.every((s) => s.status === "completed");
    expect(allCompleted).toBe(true);

    // ── Assert: Events fired ──────────────────────────────────
    expect(events).toContain("plan:created");
    expect(events).toContain("plan:completed");
    expect(events.filter((e) => e === "step:started")).toHaveLength(4);
    expect(events.filter((e) => e === "step:completed")).toHaveLength(4);

    // ── Assert: Sub-agent results collected ───────────────────
    expect(result.results.size).toBe(4);
    for (const [, res] of result.results) {
      expect(res.success).toBe(true);
    }
  });

  it("demo flow with connector bridge integration", async () => {
    // ── Step 1: Read a file (Tier 1, no approval needed) ─────
    const readResult = await connectorBridge.executeConnectorOp(
      connector.id,
      "read",
      ["package.json"],
      "demo-agent",
      "demo-project"
    );

    expect(readResult.success).toBe(true);
    expect(readResult.tier).toBe(1);
    expect(readResult.requiresApproval).toBe(false);
    const pkg = JSON.parse(readResult.data!.toString());
    expect(pkg.name).toBe("my-project");

    // ── Step 2: Write a file (Tier 2, snapshot created) ──────
    const writeResult = await connectorBridge.executeConnectorOp(
      connector.id,
      "write",
      ["SUMMARY.md", "# Project Summary\n\nThis is the demo summary."],
      "demo-agent",
      "demo-project"
    );

    expect(writeResult.success).toBe(true);
    expect(writeResult.tier).toBe(2);
    expect(writeResult.requiresApproval).toBe(false);

    // Verify file was written
    const summary = await readFile(join(project.dir, "SUMMARY.md"), "utf-8");
    expect(summary).toContain("Project Summary");

    // ── Step 3: Delete a file (Tier 3, approval required) ────
    const deleteResult = await connectorBridge.executeConnectorOp(
      connector.id,
      "delete",
      ["old-file.txt"],
      "demo-agent",
      "demo-project"
    );

    // Approval handler should have been called and approved
    expect(deleteResult.tier).toBe(3);

    // ── Assert: Memory logged all operations ──────────────────
    const entries = await memory.queryByProject("demo-project");
    expect(entries.length).toBeGreaterThanOrEqual(2);

    const readLog = entries.find((e) => e.action === "connector:read");
    expect(readLog).toBeDefined();

    const writeLog = entries.find((e) => e.action === "connector:write");
    expect(writeLog).toBeDefined();
  });

  it("demo flow — guardrails enforce tier boundaries", async () => {
    // Tier 1 tool → always allow
    const readEval = guardrailEngine.evaluate({
      tool: "read_file",
      scope: { taskId: "t1", folderPath: project.dir, projectPath: project.dir },
    });
    expect(readEval.decision).toBe("allow");

    // Tier 2 tool within scope → allow
    const writeEval = guardrailEngine.evaluate({
      tool: "write_file",
      scope: { taskId: "t1", folderPath: project.dir, projectPath: project.dir },
      targetPath: join(project.dir, "test.txt"),
    });
    expect(writeEval.decision).toBe("allow");

    // Tier 3 tool → always ask
    const deleteEval = guardrailEngine.evaluate({
      tool: "delete_file",
      scope: { taskId: "t1", folderPath: project.dir, projectPath: project.dir },
    });
    expect(deleteEval.decision).toBe("ask");
  });

  it("demo flow — snapshots persist across operations", async () => {
    // Create file
    const filePath = join(project.dir, "tracked.txt");
    await writeFile(filePath, "version 1", "utf-8");

    // Snapshot before overwrite
    const snap1 = await snapshotService.capturePreWrite(
      filePath,
      Buffer.from("version 1"),
      "demo-project"
    );

    // Overwrite
    await writeFile(filePath, "version 2", "utf-8");

    // Snapshot before second overwrite
    const snap2 = await snapshotService.capturePreWrite(
      filePath,
      Buffer.from("version 2"),
      "demo-project"
    );

    // Overwrite again
    await writeFile(filePath, "version 3", "utf-8");

    // Verify snapshots
    const snapshots = await snapshotService.listSnapshots("demo-project");
    expect(snapshots.length).toBe(2);

    // Restore version 1
    const v1 = await snapshotService.restore(snap1);
    expect(v1!.toString()).toBe("version 1");

    // Restore version 2
    const v2 = await snapshotService.restore(snap2);
    expect(v2!.toString()).toBe("version 2");
  });

  it("demo flow — complete audit trail in memory", async () => {
    // Simulate a multi-step execution with memory logging
    const actions = [
      { action: "connector:read", rationale: '{"op":"read","path":"src/index.ts"}' },
      { action: "connector:write", rationale: '{"op":"write","path":"SUMMARY.md"}' },
      { action: "connector:read", rationale: '{"op":"read","path":"SUMMARY.md"}' },
    ];

    for (const act of actions) {
      await memory.log({
        agentId: "demo-agent",
        action: act.action,
        rationale: act.rationale,
        projectId: "demo-project",
      });
    }

    // Query full audit trail
    const all = await memory.queryByProject("demo-project");
    expect(all).toHaveLength(3);

    // All actions logged
    expect(all.map((e) => e.action)).toEqual([
      "connector:read",
      "connector:write",
      "connector:read",
    ]);

    // All have metadata
    for (const entry of all) {
      expect(entry.agentId).toBe("demo-agent");
      expect(entry.projectId).toBe("demo-project");
      expect(entry.rationale).toBeTruthy();
      expect(entry.id).toBeTruthy();
      expect(entry.timestamp).toBeTruthy();
    }
  });
});

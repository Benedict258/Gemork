import { describe, it, expect, beforeEach } from "vitest";
import {
  GuardrailEngine,
  checkPermission,
  approveAction,
  isPathWithinScope,
  isConnectorFirstUse,
  resetSession,
} from "../../src/guardrails/index.js";
import type { Scope, ToolName } from "../../src/guardrails/index.js";
import { classifyTool, isReadOnlyTool, isReversibleTool, isCriticalTool } from "../../src/guardrails/tool-classification.js";
import { createPlanStep } from "../../src/orchestrator/plan.js";

const defaultScope: Scope = {
  taskId: "task-1",
  folderPath: "/home/user/project/src",
  projectPath: "/home/user/project",
};

describe("guardrails", () => {
  beforeEach(() => {
    resetSession();
  });

  describe("tool-classification", () => {
    it("classifies read_file as Tier 1", () => {
      expect(classifyTool("read_file")).toBe(1);
    });

    it("classifies write_file as Tier 2", () => {
      expect(classifyTool("write_file")).toBe(2);
    });

    it("classifies delete_file as Tier 3", () => {
      expect(classifyTool("delete_file")).toBe(3);
    });

    it("isReadOnlyTool returns true for Tier 1", () => {
      expect(isReadOnlyTool("read_file")).toBe(true);
      expect(isReadOnlyTool("search")).toBe(true);
      expect(isReadOnlyTool("list_files")).toBe(true);
    });

    it("isReversibleTool returns true for Tier 2", () => {
      expect(isReversibleTool("write_file")).toBe(true);
      expect(isReversibleTool("edit_file")).toBe(true);
      expect(isReversibleTool("create_directory")).toBe(true);
    });

    it("isCriticalTool returns true for Tier 3", () => {
      expect(isCriticalTool("delete_file")).toBe(true);
      expect(isCriticalTool("external_api")).toBe(true);
      expect(isCriticalTool("send_message")).toBe(true);
    });

    it("unknown tools default to Tier 3", () => {
      expect(classifyTool("unknown_tool" as ToolName)).toBe(3);
    });
  });

  describe("permission-gate", () => {
    it("Tier 1 tool always allows", () => {
      const result = checkPermission("read_file", defaultScope);
      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(false);
    });

    it("Tier 2 tool within scope allows", () => {
      const result = checkPermission("write_file", defaultScope, "/home/user/project/src/file.ts");
      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(false);
    });

    it("Tier 2 tool outside project scope escalates", () => {
      const result = checkPermission("write_file", defaultScope, "/etc/passwd");
      expect(result.allowed).toBe(false);
      expect(result.requiresApproval).toBe(true);
    });

    it("Tier 2 tool outside folder scope escalates", () => {
      const result = checkPermission("write_file", defaultScope, "/home/user/project/other/file.ts");
      expect(result.allowed).toBe(false);
      expect(result.requiresApproval).toBe(true);
    });

    it("Tier 3 tool always asks", () => {
      const result = checkPermission("delete_file", defaultScope);
      expect(result.allowed).toBe(false);
      expect(result.requiresApproval).toBe(true);
    });

    it("Connector first use requires approval", () => {
      const first = isConnectorFirstUse("my-connector");
      expect(first).toBe(true);
      const second = isConnectorFirstUse("my-connector");
      expect(second).toBe(false);
    });

    it("approveAction overrides requiresApproval", () => {
      const result = checkPermission("delete_file", defaultScope);
      expect(result.requiresApproval).toBe(true);

      const approved = approveAction("delete_file", defaultScope);
      expect(approved.allowed).toBe(true);
      expect(approved.requiresApproval).toBe(false);
    });

    it("isPathWithinScope checks path containment", () => {
      expect(isPathWithinScope("/home/user/project/src/file.ts", "/home/user/project")).toBe(true);
      expect(isPathWithinScope("/etc/passwd", "/home/user/project")).toBe(false);
    });
  });

  describe("GuardrailEngine", () => {
    let engine: GuardrailEngine;

    beforeEach(() => {
      resetSession();
      engine = new GuardrailEngine();
    });

    it("Tier 1 tool always returns allow", () => {
      const step = createPlanStep("g1", "Read files", 1);
      const result = engine.evaluate({
        step,
        scope: defaultScope,
        tool: "read_file",
      });

      expect(result.decision).toBe("allow");
      expect(result.tier).toBe(1);
    });

    it("Tier 2 tool within scope returns allow", () => {
      const step = createPlanStep("g1", "Write file", 2);
      const result = engine.evaluate({
        step,
        scope: defaultScope,
        tool: "write_file",
        targetPath: "/home/user/project/src/new.ts",
      });

      expect(result.decision).toBe("allow");
      expect(result.tier).toBe(2);
    });

    it("Tier 2 tool outside scope returns ask", () => {
      const step = createPlanStep("g1", "Write file", 2);
      const result = engine.evaluate({
        step,
        scope: defaultScope,
        tool: "write_file",
        targetPath: "/etc/critical.conf",
      });

      expect(result.decision).toBe("ask");
      expect(result.permission.requiresApproval).toBe(true);
    });

    it("Tier 3 tool always returns ask", () => {
      const step = createPlanStep("g1", "Delete file", 3);
      const result = engine.evaluate({
        step,
        scope: defaultScope,
        tool: "delete_file",
      });

      expect(result.decision).toBe("ask");
      expect(result.tier).toBe(3);
    });

    it("Connector first use triggers ask", () => {
      const step = createPlanStep("g1", "Write via connector", 2);
      const result = engine.evaluate({
        step,
        scope: { ...defaultScope, connectorId: "new-connector" },
        tool: "connector_write",
      });

      expect(result.decision).toBe("ask");
    });

    it("Connector approved → subsequent uses allowed", () => {
      const step = createPlanStep("g1", "Write via connector", 2);
      const scope = { ...defaultScope, connectorId: "approved-connector" };

      // First use
      const first = engine.evaluate({ step, scope, tool: "connector_write" });
      expect(first.decision).toBe("ask");

      // Approve
      engine.approveEvaluation(first, scope);

      // Second use
      const second = engine.evaluate({ step, scope, tool: "connector_write" });
      expect(second.decision).toBe("allow");
    });

    it("deniedTool blocks all evaluations for that tool", () => {
      engine.denyTool("external_api");
      const step = createPlanStep("g1", "Call API", 3);
      const result = engine.evaluate({
        step,
        scope: defaultScope,
        tool: "external_api",
      });

      expect(result.decision).toBe("deny");
      expect(result.permission.allowed).toBe(false);
    });

    it("requiresApproval returns true only for Tier 3", () => {
      const tier1 = createPlanStep("g1", "Read", 1);
      const tier2 = createPlanStep("g1", "Write", 2);
      const tier3 = createPlanStep("g1", "Delete", 3);

      expect(engine.requiresApproval(tier1)).toBe(false);
      expect(engine.requiresApproval(tier2)).toBe(false);
      expect(engine.requiresApproval(tier3)).toBe(true);
    });

    it("extracts tool from step description when tool not provided", () => {
      const readStep = createPlanStep("g1", "Read the configuration file", 1);
      const result = engine.evaluate({ step: readStep, scope: defaultScope });
      expect(result.tool).toBe("read_file");
    });

    it("scope enforcement blocks path traversal", () => {
      const step = createPlanStep("g1", "Write file", 2);
      const result = engine.evaluate({
        step,
        scope: defaultScope,
        tool: "write_file",
        targetPath: "/home/user/project/../../etc/passwd",
      });

      expect(result.decision).toBe("ask");
    });

    it("approval log is maintained", () => {
      const step = createPlanStep("g1", "Delete file", 3);
      engine.evaluate({ step, scope: defaultScope, tool: "delete_file" });

      const log = engine.getApprovalLog();
      expect(log).toHaveLength(1);
      expect(log[0].tool).toBe("delete_file");
      expect(log[0].decision).toBe("ask");
    });
  });
});

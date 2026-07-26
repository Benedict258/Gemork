export { checkPermission, approveAction, isPathWithinScope, isConnectorFirstUse, resetSession } from "./permission-gate.js";
export type { Scope, PermissionResult } from "./permission-gate.js";

export {
  classifyTool,
  getToolsForTier,
  getTier1Tools,
  getTier2Tools,
  getTier3Tools,
  isReadOnlyTool,
  isReversibleTool,
  isCriticalTool,
  getAllClassifications,
} from "./tool-classification.js";
export type { ToolName, ToolClassification } from "./tool-classification.js";

import type { PlanStep, StepTier } from "../orchestrator/plan.js";
import {
  checkPermission,
  approveAction,
  isPathWithinScope,
  isConnectorFirstUse,
  type Scope,
  type PermissionResult,
} from "./permission-gate.js";
import { classifyTool, type ToolName } from "./tool-classification.js";

export type GuardrailDecision = "allow" | "ask" | "deny";

export interface EvaluationContext {
  step?: PlanStep;
  tool?: ToolName;
  scope: Scope;
  targetPath?: string;
}

export interface EvaluationResult {
  decision: GuardrailDecision;
  permission: PermissionResult;
  tier: StepTier;
  tool?: ToolName;
}

export interface ApprovalLogEntry {
  timestamp: number;
  tool: ToolName;
  scope: Scope;
  decision: GuardrailDecision;
  targetPath?: string;
}

export class GuardrailEngine {
  private deniedTools = new Set<ToolName>();
  private approvalLog: ApprovalLogEntry[] = [];

  evaluate(ctx: EvaluationContext): EvaluationResult {
    const tool = ctx.tool ?? this.extractToolFromStep(ctx.step);
    if (!tool) {
      return {
        decision: "deny",
        permission: { allowed: false, reason: "No tool or step provided", requiresApproval: false },
        tier: 3,
      };
    }

    if (this.deniedTools.has(tool)) {
      return {
        decision: "deny",
        permission: { allowed: false, reason: `Tool '${tool}' is permanently denied`, requiresApproval: false },
        tier: classifyTool(tool),
        tool,
      };
    }

    const tier = ctx.step?.tier ?? classifyTool(tool);
    const permission = checkPermission(tool, ctx.scope, ctx.targetPath);

    let decision: GuardrailDecision;
    if (permission.allowed) {
      decision = tier === 3 ? "ask" : "allow";
    } else if (permission.requiresApproval) {
      decision = "ask";
    } else {
      decision = "deny";
    }

    // Override: Tier 2 within scope → always allow
    if (tier === 2 && permission.allowed) {
      decision = "allow";
    }

    // Override: Tier 1 → always allow
    if (tier === 1) {
      decision = "allow";
    }

    // Override: Tier 3 → always ask (even if permission gate says allowed)
    if (tier === 3) {
      decision = "ask";
    }

    this.approvalLog.push({
      timestamp: Date.now(),
      tool,
      scope: ctx.scope,
      decision,
      targetPath: ctx.targetPath,
    });

    return { decision, permission, tier, tool };
  }

  approveEvaluation(result: EvaluationResult, scope: Scope): EvaluationResult {
    if (result.decision === "ask" && result.permission.requiresApproval) {
      const approved = approveAction(result.tool!, scope, undefined);
      return { ...result, decision: "allow", permission: approved };
    }
    return result;
  }

  denyTool(tool: ToolName): void {
    this.deniedTools.add(tool);
  }

  isWithinScope(targetPath: string, scope: Scope): boolean {
    return isPathWithinScope(targetPath, scope.projectPath);
  }

  isWithinTaskFolder(targetPath: string, scope: Scope): boolean {
    return isPathWithinScope(targetPath, scope.folderPath);
  }

  requiresApproval(step: PlanStep): boolean {
    return step.tier === 3;
  }

  requiresApprovalForTool(tool: ToolName): boolean {
    return classifyTool(tool) === 3;
  }

  getApprovalLog(): readonly ApprovalLogEntry[] {
    return this.approvalLog;
  }

  getDeniedTools(): readonly ToolName[] {
    return Array.from(this.deniedTools);
  }

  private extractToolFromStep(step?: PlanStep): ToolName | undefined {
    if (!step) return undefined;
    const desc = step.description.toLowerCase();
    if (desc.includes("read") || desc.includes("search") || desc.includes("query")) return "read_file";
    if (desc.includes("write") || desc.includes("create")) return "write_file";
    if (desc.includes("edit") || desc.includes("modify") || desc.includes("update")) return "edit_file";
    if (desc.includes("delete") || desc.includes("remove")) return "delete_file";
    if (desc.includes("send") || desc.includes("message")) return "send_message";
    return undefined;
  }
}

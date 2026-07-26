import type { StepTier } from "../orchestrator/plan.js";
import { classifyTool, type ToolName } from "./tool-classification.js";

export interface Scope {
  taskId: string;
  folderPath: string;
  projectPath: string;
  connectorId?: string;
}

export interface PermissionResult {
  allowed: boolean;
  reason?: string;
  requiresApproval: boolean;
}

interface ConnectorUsage {
  connectorId: string;
  sessionId: string;
  firstUsedAt: number;
}

const connectorUsage = new Map<string, ConnectorUsage>();
let currentSessionId = crypto.randomUUID();

export function resetSession(): void {
  connectorUsage.clear();
  currentSessionId = crypto.randomUUID();
}

export function isPathWithinScope(targetPath: string, scopePath: string): boolean {
  const normalised = targetPath.replace(/\\/g, "/");
  const normalisedScope = scopePath.replace(/\\/g, "/");
  return normalised.startsWith(normalisedScope);
}

export function isConnectorFirstUse(connectorId: string): boolean {
  const key = `${currentSessionId}:${connectorId}`;
  if (connectorUsage.has(key)) return false;
  connectorUsage.set(key, {
    connectorId,
    sessionId: currentSessionId,
    firstUsedAt: Date.now(),
  });
  return true;
}

export function checkPermission(
  tool: ToolName,
  scope: Scope,
  targetPath?: string
): PermissionResult {
  const tier = classifyTool(tool);

  // Tier 1: always allow read-only
  if (tier === 1) {
    return { allowed: true, requiresApproval: false };
  }

  // Connector actions always require approval on first use per session
  if (scope.connectorId && isConnectorFirstUse(scope.connectorId)) {
    return {
      allowed: false,
      reason: `First use of connector '${scope.connectorId}' this session — requires user approval`,
      requiresApproval: true,
    };
  }

  // Tier 3: always require approval
  if (tier === 3) {
    return {
      allowed: false,
      reason: `Critical action '${tool}' requires user approval`,
      requiresApproval: true,
    };
  }

  // Tier 2: check scope — if outside project scope, escalate to Tier 3
  if (tier === 2 && targetPath) {
    const withinProject = isPathWithinScope(targetPath, scope.projectPath);
    if (!withinProject) {
      return {
        allowed: false,
        reason: `Write action '${tool}' targets path outside project scope: ${targetPath}`,
        requiresApproval: true,
      };
    }

    const withinFolder = isPathWithinScope(targetPath, scope.folderPath);
    if (!withinFolder) {
      return {
        allowed: false,
        reason: `Write action '${tool}' targets path outside task folder: ${targetPath}`,
        requiresApproval: true,
      };
    }
  }

  // Tier 2: within scope — allow (logged by caller)
  return { allowed: true, requiresApproval: false };
}

export function approveAction(tool: ToolName, scope: Scope, targetPath?: string): PermissionResult {
  const result = checkPermission(tool, scope, targetPath);
  if (result.requiresApproval) {
    return { allowed: true, reason: "User approved", requiresApproval: false };
  }
  return result;
}

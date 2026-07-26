import { randomUUID } from "node:crypto";
import type { IConnector, ConnectorResult } from "./base-connector.js";
import type { ConnectorManager } from "./connector-manager.js";
import { GuardrailEngine } from "../guardrails/index.js";
import { SnapshotService } from "../storage/snapshot-service.js";
import { BuildContextMemory } from "../storage/build-context-memory.js";

export type ConnectorOp =
  | "read"
  | "list"
  | "stat"
  | "write"
  | "edit"
  | "mkdir"
  | "move"
  | "copy"
  | "delete";

export interface BridgeContext {
  connectorId: string;
  op: ConnectorOp;
  args: unknown[];
  agentId: string;
  projectId: string;
}

export interface ConnectorBridgeConfig {
  connectorManager: ConnectorManager;
  guardrailEngine: GuardrailEngine;
  snapshotService: SnapshotService;
  buildContextMemory: BuildContextMemory;
  onApprovalRequest?: (ctx: BridgeContext) => Promise<boolean>;
}

function opTier(op: ConnectorOp): 1 | 2 | 3 {
  if (op === "read" || op === "list" || op === "stat") return 1;
  if (op === "delete") return 3;
  return 2;
}

function opName(op: ConnectorOp): string {
  const map: Record<ConnectorOp, string> = {
    read: "read_file",
    list: "list_files",
    stat: "get_file_info",
    write: "write_file",
    edit: "edit_file",
    mkdir: "create_directory",
    move: "move_file",
    copy: "copy_file",
    delete: "delete_file",
  };
  return map[op];
}

export class ConnectorBridge {
  private manager: ConnectorManager;
  private guardrails: GuardrailEngine;
  private snapshots: SnapshotService;
  private memory: BuildContextMemory;
  private onApprovalRequest?: (ctx: BridgeContext) => Promise<boolean>;

  constructor(config: ConnectorBridgeConfig) {
    this.manager = config.connectorManager;
    this.guardrails = config.guardrailEngine;
    this.snapshots = config.snapshotService;
    this.memory = config.buildContextMemory;
    this.onApprovalRequest = config.onApprovalRequest;
  }

  async executeConnectorOp(
    connectorId: string,
    op: ConnectorOp,
    args: unknown[],
    agentId: string,
    projectId: string
  ): Promise<ConnectorResult> {
    const ctx: BridgeContext = { connectorId, op, args, agentId, projectId };
    const startTime = Date.now();

    const connector = this.manager.getConnector(connectorId);
    if (!connector) {
      const errorResult: ConnectorResult = {
        success: false,
        error: `Connector '${connectorId}' not found`,
        tier: opTier(op),
        requiresApproval: false,
      };
      await this.logOperation(ctx, errorResult, startTime);
      return errorResult;
    }

    const tier = opTier(op);
    const scope = connector.getScope();

    const toolName = opName(op) as Parameters<typeof this.guardrails.evaluate>[0]["tool"];
    const evalResult = this.guardrails.evaluate({
      tool: toolName,
      scope: {
        taskId: connectorId,
        folderPath: scope.basePath,
        projectPath: scope.basePath,
        connectorId,
      },
      targetPath: typeof args[0] === "string" ? args[0] : undefined,
    });

    if (evalResult.decision === "deny") {
      const denyResult: ConnectorResult = {
        success: false,
        error: `Operation denied by guardrails: ${evalResult.permission.reason}`,
        tier,
        requiresApproval: false,
      };
      await this.logOperation(ctx, denyResult, startTime);
      return denyResult;
    }

    if (evalResult.decision === "ask") {
      if (this.onApprovalRequest) {
        const approved = await this.onApprovalRequest(ctx);
        if (!approved) {
          const rejectedResult: ConnectorResult = {
            success: false,
            error: "Operation rejected by user",
            tier,
            requiresApproval: true,
          };
          await this.logOperation(ctx, rejectedResult, startTime);
          return rejectedResult;
        }
        this.manager.approveConnector(connectorId);
      } else {
        const noHandlerResult: ConnectorResult = {
          success: false,
          error: "Approval required but no approval handler configured",
          tier,
          requiresApproval: true,
        };
        await this.logOperation(ctx, noHandlerResult, startTime);
        return noHandlerResult;
      }
    }

    let result: ConnectorResult;
    try {
      result = await this.invokeOp(connector, op, args);
    } catch (err) {
      result = {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        tier,
        requiresApproval: tier === 3,
      };
    }

    await this.logOperation(ctx, result, startTime);
    return result;
  }

  private async invokeOp(
    connector: IConnector,
    op: ConnectorOp,
    args: unknown[]
  ): Promise<ConnectorResult> {
    switch (op) {
      case "read":
        return connector.read(args[0] as string);
      case "list":
        return connector.list(args[0] as string | undefined);
      case "stat":
        return connector.stat(args[0] as string);
      case "write":
        return connector.write(args[0] as string, args[1] as string | Buffer);
      case "edit":
        return connector.edit(args[0] as string, args[1] as string, args[2] as string);
      case "mkdir":
        return connector.mkdir(args[0] as string);
      case "move":
        return connector.move(args[0] as string, args[1] as string);
      case "copy":
        return connector.copy(args[0] as string, args[1] as string);
      case "delete":
        return connector.delete(args[0] as string);
      default:
        return {
          success: false,
          error: `Unknown operation: ${op}`,
          tier: 3,
          requiresApproval: false,
        };
    }
  }

  private async logOperation(
    ctx: BridgeContext,
    result: ConnectorResult,
    startTime: number
  ): Promise<void> {
    const durationMs = Date.now() - startTime;
    await this.memory.log({
      agentId: ctx.agentId,
      action: `connector:${ctx.op}`,
      rationale: JSON.stringify({
        connectorId: ctx.connectorId,
        op: ctx.op,
        args: ctx.args,
        success: result.success,
        tier: result.tier,
        durationMs,
      }),
      projectId: ctx.projectId,
    });
  }
}

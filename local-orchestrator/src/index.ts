// Re-export the orchestrator core
export * from "./orchestrator/index.js";

// Re-export legacy types from plan module (backward compatibility)
export type { Goal, Plan, PlanStep, StepStatus, StepTier } from "./orchestrator/plan.js";
export { createGoal, createPlan, createPlanStep } from "./orchestrator/plan.js";

// LLM abstraction layer
export * from "./llm/index.js";

// Guardrails
export { GuardrailEngine } from "./guardrails/index.js";
export type {
  GuardrailDecision,
  EvaluationContext,
  EvaluationResult,
  Scope,
  PermissionResult,
  ToolName,
  ToolClassification,
} from "./guardrails/index.js";
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
  checkPermission,
  approveAction,
  isPathWithinScope,
  isConnectorFirstUse,
  resetSession,
} from "./guardrails/index.js";

// Storage
export {
  SnapshotService,
  BuildContextMemory,
  MemoryStore,
} from "./storage/index.js";
export type {
  Snapshot,
  MemoryEntry,
  TaskRow,
  PlanRow,
  ConnectorConfig,
  PermissionRecord,
} from "./storage/index.js";

// Connector Adapter Layer
export {
  FilesystemConnector,
  ConnectorManager,
  ConnectorBridge,
} from "./connectors/index.js";
export type {
  IConnector,
  ConnectorResult,
  ConnectorScope,
  FilesystemConnectorConfig,
  ConnectorOp,
  BridgeContext,
  ConnectorBridgeConfig,
} from "./connectors/index.js";

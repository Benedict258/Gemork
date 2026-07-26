// ─── Core Exports ────────────────────────────────────────────

export {
  TaskEngine,
  createLLMProvider,
  createPlanGenerator,
  type LLMPlanGenerator,
  type LLMPlanOutput,
  type TaskEngineConfig,
  type TaskEngineRunOptions,
  type TaskEngineRunResult,
} from "./task-engine.js";

export {
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
  type Goal,
  type Plan,
  type PlanStep,
  type StepTier,
  type StepStatus,
  type PlanStatus,
} from "./plan.js";

export {
  SubAgentCoordinator,
  type SubAgentTask,
  type SubAgentStatus,
  type SubAgentTaskResult,
  type SubAgentCoordinatorOptions,
} from "./sub-agent-coordinator.js";

export {
  OrchestratorEventBus,
  EventBroadcaster,
  type OrchestratorEvent,
  type OrchestratorEventType,
  type EventHandler,
  type PlanCreatedEvent,
  type PlanUpdatedEvent,
  type PlanCompletedEvent,
  type PlanPausedEvent,
  type StepStartedEvent,
  type StepCompletedEvent,
  type StepFailedEvent,
  type ApprovalRequestEvent,
  type ApprovalGrantedEvent,
  type ApprovalRejectedEvent,
  type SubAgentQueuedEvent,
  type SubAgentRunningEvent,
  type SubAgentCompletedEvent,
  type SubAgentFailedEvent,
} from "./event-bus.js";

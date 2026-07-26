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

// Voice Module
export {
  AudioProcessor,
  audioBufferToWav,
  trimSilence,
} from "./voice/audio-processor.js";
export {
  type TranscriptionProvider,
  WhisperLocalProvider,
  WebSpeechFallbackProvider,
  createTranscriptionProvider,
} from "./voice/transcription-provider.js";
export { VoiceHandler } from "./voice/voice-handler.js";
export { VoiceWebSocket } from "./voice/voice-websocket.js";

// RAG System
export {
  OllamaEmbeddingProvider,
  SimpleEmbeddingProvider,
  createEmbeddingProvider,
  VectorStore,
  MemoryIndexer,
  RagRetriever,
  buildRagPromptSection,
} from "./rag/index.js";
export type {
  EmbeddingProvider,
  VectorEntry,
  SearchResult,
  VectorStoreStats,
  RagContext,
  MemoryEntry as RagMemoryEntry,
  FileContext,
  PlanContext,
} from "./rag/index.js";

// Error types
export {
  GemorkError,
  LLMError,
  ConnectorError,
  GuardrailError,
  StorageError,
  SnapshotError,
  isGemorkError,
  isLLMError,
  isConnectorError,
  isGuardrailError,
  isStorageError,
  isSnapshotError,
} from "./errors.js";
export type {
  LLMErrorCode as GemorkLLMErrorCode,
  ConnectorErrorCode,
  GuardrailErrorCode,
  StorageErrorCode,
  SnapshotErrorCode,
} from "./errors.js";

// Middleware
export {
  createErrorHandler,
  createAsyncHandler,
  onError,
  createLogger,
  setLogLevel,
  getLogLevel,
  healthCheckHandler,
  registerHealthCheck,
  createDefaultHealthChecks,
} from "./middleware/index.js";
export type { ErrorEvent, LogLevel, Logger, LogEntry, ModuleHealth, HealthChecker } from "./middleware/index.js";

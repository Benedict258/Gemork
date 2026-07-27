export type { LLMConfig, GemmaModelInfo } from "./config.js";
export { loadLLMConfig, resolveGemmaModel, GEMMA_MODELS } from "./config.js";

export type {
  LLMProvider,
  LLMResponse,
  ChatMessage,
  ChatOptions,
  ToolCall,
  ToolDefinition,
  LLMUsage,
  LLMStreamChunk,
} from "./provider.js";

export { OllamaProvider } from "./providers/ollama-provider.js";
export { LlamaCppProvider } from "./providers/llamacpp-provider.js";
export { OpenAIProvider, type OpenAIProviderConfig } from "./providers/openai-provider.js";
export { AnthropicProvider, type AnthropicProviderConfig } from "./providers/anthropic-provider.js";

export {
  registerProvider,
  getProvider,
  listProviders,
  hasProvider,
} from "./provider-registry.js";

export { parseToolCalls } from "./tool-parser.js";
export { DirtyJson, tryParse, extractJson } from "./dirty-json.js";
export { LLMPlanGeneratorImpl, parsePlanOutput } from "./plan-generator.js";
export { createStreamingAccumulator, consumeStream, responseToLineIterable } from "./streaming.js";
export type { StreamingAccumulator } from "./streaming.js";
export {
  LLMError,
  LLMTimeoutError,
  LLMModelNotFoundError,
  LLMProviderUnreachableError,
} from "./errors.js";
export type { LLMErrorCode } from "./errors.js";

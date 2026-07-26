export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[];
  usage?: LLMUsage;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  toolCallId?: string;
}

export interface ChatOptions {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
  signal?: AbortSignal;
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LLMProvider {
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<LLMResponse>;
  chatStream?(messages: ChatMessage[], options?: ChatOptions): AsyncIterable<LLMStreamChunk>;
  isAvailable(): Promise<boolean>;
  listModels?(): Promise<string[]>;
}

export interface LLMStreamChunk {
  content: string;
  done: boolean;
}

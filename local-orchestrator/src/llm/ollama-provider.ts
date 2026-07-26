import {
  type LLMProvider,
  type ChatMessage,
  type ChatOptions,
  type LLMResponse,
  type LLMStreamChunk,
  type ToolDefinition,
} from "./provider.js";
import type { LLMConfig } from "./config.js";
import {
  LLMProviderUnreachableError,
  LLMModelNotFoundError,
  LLMTimeoutError,
} from "./errors.js";

export class OllamaProvider implements LLMProvider {
  private config: LLMConfig;
  private cachedModels: string[] | null = null;

  constructor(config: LLMConfig) {
    this.config = config;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.config.baseUrl}/api/tags`, {
        method: "GET",
        signal: AbortSignal.timeout(5_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    if (this.cachedModels) return this.cachedModels;

    try {
      const res = await fetch(`${this.config.baseUrl}/api/tags`, {
        method: "GET",
        signal: AbortSignal.timeout(5_000),
      });

      if (!res.ok) {
        this.cachedModels = [];
        return [];
      }

      const data = (await res.json()) as OllamaTagsResponse;
      this.cachedModels = data.models?.map((m) => m.name) ?? [];
      return this.cachedModels;
    } catch {
      this.cachedModels = [];
      return [];
    }
  }

  async ensureModelAvailable(): Promise<void> {
    const models = await this.listModels();
    const requested = this.config.model;

    const found = models.some(
      (m) => m === requested || m.startsWith(requested + ":"),
    );

    if (!found) {
      throw new LLMModelNotFoundError(requested, models);
    }
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<LLMResponse> {
    const timeoutMs = this.config.timeoutMs ?? 30_000;
    const signal = combineSignals(options?.signal, timeoutMs);

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.name ? { name: m.name } : {}),
        ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
      })),
      stream: false,
      options: {
        temperature: options?.temperature ?? this.config.temperature,
        top_p: options?.topP ?? this.config.topP,
        num_predict: options?.maxTokens ?? this.config.maxTokens,
      },
    };

    if (options?.tools && options.tools.length > 0) {
      body.tools = options.tools.map((t) => ({
        type: "function",
        function: {
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        },
      }));
    }

    let res: Response;
    try {
      res = await fetch(`${this.config.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (signal.aborted && err instanceof Error && err.message.includes("Timeout")) {
        throw new LLMTimeoutError(timeoutMs);
      }
      throw new LLMProviderUnreachableError(this.config.baseUrl);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Ollama error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as OllamaChatResponse;
    const msg = data.message;

    const toolCalls = msg.tool_calls?.map((tc) => ({
      id: tc.id ?? `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: tc.function.name,
      arguments: typeof tc.function.arguments === "string"
        ? safeParse(tc.function.arguments)
        : tc.function.arguments ?? {},
    }));

    return {
      content: msg.content ?? "",
      toolCalls: toolCalls?.length ? toolCalls : undefined,
      usage: data.eval_count != null
        ? { promptTokens: data.prompt_eval_count ?? 0, completionTokens: data.eval_count }
        : undefined,
    };
  }

  async *chatStream(messages: ChatMessage[], options?: ChatOptions): AsyncIterable<LLMStreamChunk> {
    const timeoutMs = this.config.timeoutMs ?? 30_000;
    const controller = new AbortController();
    const userSignal = options?.signal;
    const timer = setTimeout(() => controller.abort(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs);

    if (userSignal) {
      userSignal.addEventListener("abort", () => controller.abort(userSignal.reason), { once: true });
    }

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.name ? { name: m.name } : {}),
        ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
      })),
      stream: true,
      options: {
        temperature: options?.temperature ?? this.config.temperature,
        top_p: options?.topP ?? this.config.topP,
        num_predict: options?.maxTokens ?? this.config.maxTokens,
      },
    };

    let res: Response;
    try {
      res = await fetch(`${this.config.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.message.includes("Timeout")) {
        throw new LLMTimeoutError(timeoutMs);
      }
      throw new LLMProviderUnreachableError(this.config.baseUrl);
    }

    if (!res.ok) {
      clearTimeout(timer);
      const text = await res.text().catch(() => "");
      throw new Error(`Ollama error ${res.status}: ${text}`);
    }

    const reader = res.body?.getReader();
    if (!reader) {
      clearTimeout(timer);
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed) as OllamaStreamResponse;
            const chunk: LLMStreamChunk = {
              content: parsed.message?.content ?? "",
              done: parsed.done ?? false,
            };
            yield chunk;
            if (chunk.done) return;
          } catch {
            // skip malformed lines
          }
        }
      }
    } finally {
      clearTimeout(timer);
      reader.releaseLock();
    }
  }
}

function safeParse(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

function combineSignals(userSignal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  if (!userSignal) return AbortSignal.timeout(timeoutMs);
  const controller = new AbortController();
  const onAbort = () => controller.abort(userSignal.reason);
  userSignal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => {
    userSignal.removeEventListener("abort", onAbort);
    controller.abort(new Error(`Timeout after ${timeoutMs}ms`));
  }, timeoutMs);
  controller.signal.addEventListener("abort", () => {
    clearTimeout(timer);
    userSignal.removeEventListener("abort", onAbort);
  }, { once: true });
  return controller.signal;
}

interface OllamaChatResponse {
  message: {
    role: string;
    content: string;
    tool_calls?: {
      id?: string;
      function: {
        name: string;
        arguments: string | Record<string, unknown>;
      };
    }[];
  };
  eval_count?: number;
  prompt_eval_count?: number;
}

interface OllamaStreamResponse {
  message?: {
    content?: string;
  };
  done?: boolean;
}

interface OllamaTagsResponse {
  models?: {
    name: string;
    size: number;
  }[];
}

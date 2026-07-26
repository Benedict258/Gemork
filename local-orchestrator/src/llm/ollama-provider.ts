import {
  type LLMProvider,
  type ChatMessage,
  type ChatOptions,
  type LLMResponse,
  type ToolDefinition,
} from "./provider.js";
import type { LLMConfig } from "./config.js";

export class OllamaProvider implements LLMProvider {
  private config: LLMConfig;

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

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<LLMResponse> {
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

    const timeoutMs = this.config.timeoutMs ?? 30_000;
    const signal = combineSignals(options?.signal, timeoutMs);

    const res = await fetch(`${this.config.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });

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

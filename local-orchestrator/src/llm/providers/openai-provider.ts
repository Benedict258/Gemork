import {
  type LLMProvider,
  type ChatMessage,
  type ChatOptions,
  type LLMResponse,
  type ToolDefinition,
} from "../provider.js";
import {
  LLMProviderUnreachableError,
  LLMTimeoutError,
} from "../errors.js";

export interface OpenAIProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export class OpenAIProvider implements LLMProvider {
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private temperature: number;
  private maxTokens: number;
  private timeoutMs: number;

  constructor(config?: OpenAIProviderConfig) {
    this.apiKey = config?.apiKey ?? process.env.GEMORK_OPENAI_API_KEY ?? "";
    this.baseUrl = (config?.baseUrl ?? process.env.GEMORK_OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.model = config?.model ?? process.env.GEMORK_OPENAI_MODEL ?? "gpt-4o";
    this.temperature = config?.temperature ?? 0.3;
    this.maxTokens = config?.maxTokens ?? 2048;
    this.timeoutMs = config?.timeoutMs ?? 120_000;
  }

  async isAvailable(): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        method: "GET",
        headers: this.buildHeaders(),
        signal: AbortSignal.timeout(5_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    if (!this.apiKey) return [];
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        method: "GET",
        headers: this.buildHeaders(),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as { data?: { id: string }[] };
      return data.data?.map((m) => m.id) ?? [];
    } catch {
      return [];
    }
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<LLMResponse> {
    const timeoutMs = options?.signal ? this.timeoutMs : this.timeoutMs;
    const signal = combineSignals(options?.signal, timeoutMs);

    const body: Record<string, unknown> = {
      model: this.model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.name ? { name: m.name } : {}),
        ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
      })),
      temperature: options?.temperature ?? this.temperature,
      max_tokens: options?.maxTokens ?? this.maxTokens,
    };

    if (options?.topP !== undefined) {
      body.top_p = options.topP;
    }

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
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (signal.aborted && err instanceof Error && err.message.includes("Timeout")) {
        throw new LLMTimeoutError(timeoutMs);
      }
      throw new LLMProviderUnreachableError(this.baseUrl);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`OpenAI API error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as OpenAIChatResponse;
    const choice = data.choices?.[0];
    const message = choice?.message;

    const toolCalls = message?.tool_calls?.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: typeof tc.function.arguments === "string"
        ? safeParse(tc.function.arguments)
        : tc.function.arguments ?? {},
    }));

    return {
      content: message?.content ?? "",
      toolCalls: toolCalls?.length ? toolCalls : undefined,
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
          }
        : undefined,
    };
  }

  private buildHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
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

interface OpenAIChatResponse {
  choices?: {
    message?: {
      content?: string;
      tool_calls?: {
        id: string;
        function: {
          name: string;
          arguments: string | Record<string, unknown>;
        };
      }[];
    };
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

import {
  type LLMProvider,
  type ChatMessage,
  type ChatOptions,
  type LLMResponse,
} from "../provider.js";
import {
  LLMProviderUnreachableError,
  LLMTimeoutError,
} from "../errors.js";

export interface AnthropicProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export class AnthropicProvider implements LLMProvider {
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private temperature: number;
  private maxTokens: number;
  private timeoutMs: number;

  constructor(config?: AnthropicProviderConfig) {
    this.apiKey = config?.apiKey ?? process.env.GEMORK_ANTHROPIC_API_KEY ?? "";
    this.baseUrl = (config?.baseUrl ?? process.env.GEMORK_ANTHROPIC_BASE_URL ?? "https://api.anthropic.com").replace(/\/$/, "");
    this.model = config?.model ?? process.env.GEMORK_ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514";
    this.temperature = config?.temperature ?? 0.3;
    this.maxTokens = config?.maxTokens ?? 2048;
    this.timeoutMs = config?.timeoutMs ?? 120_000;
  }

  async isAvailable(): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      const res = await fetch(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify({
          model: this.model,
          max_tokens: 1,
          messages: [{ role: "user", content: "ping" }],
        }),
        signal: AbortSignal.timeout(5_000),
      });
      return res.ok || res.status === 400;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    return [
      "claude-sonnet-4-20250514",
      "claude-3-5-sonnet-20241022",
      "claude-3-5-haiku-20241022",
      "claude-3-opus-20240229",
    ];
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<LLMResponse> {
    const signal = combineSignals(options?.signal, this.timeoutMs);

    const { system, msgs } = extractSystem(messages);

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: options?.maxTokens ?? this.maxTokens,
      messages: msgs.map((m) => ({
        role: m.role === "tool" ? "user" : m.role,
        content: m.role === "tool"
          ? `[Tool result: ${m.name ?? "unknown"}]\n${m.content}`
          : m.content,
      })),
    };

    if (system) {
      body.system = system;
    }

    if (options?.temperature !== undefined) {
      body.temperature = options.temperature ?? this.temperature;
    }

    if (options?.topP !== undefined) {
      body.top_p = options.topP;
    }

    if (options?.tools && options.tools.length > 0) {
      body.tools = options.tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }));
    }

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (signal.aborted && err instanceof Error && err.message.includes("Timeout")) {
        throw new LLMTimeoutError(this.timeoutMs);
      }
      throw new LLMProviderUnreachableError(this.baseUrl);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Anthropic API error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as AnthropicResponse;

    let content = "";
    const toolCalls: LLMResponse["toolCalls"] = [];

    for (const block of data.content ?? []) {
      if (block.type === "text") {
        content += block.text;
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id ?? "",
          name: block.name ?? "",
          arguments: (block.input as Record<string, unknown>) ?? {},
        });
      }
    }

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: data.usage
        ? {
            promptTokens: data.usage.input_tokens,
            completionTokens: data.usage.output_tokens,
          }
        : undefined,
    };
  }

  private buildHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "x-api-key": this.apiKey,
      "anthropic-version": "2023-06-01",
    };
  }
}

function extractSystem(messages: ChatMessage[]): { system: string | undefined; msgs: ChatMessage[] } {
  const systemParts: string[] = [];
  const rest: ChatMessage[] = [];

  for (const m of messages) {
    if (m.role === "system") {
      systemParts.push(m.content);
    } else {
      rest.push(m);
    }
  }

  return {
    system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
    msgs: rest,
  };
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

interface AnthropicResponse {
  content?: {
    type: string;
    text?: string;
    id?: string;
    name?: string;
    input?: unknown;
  }[];
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

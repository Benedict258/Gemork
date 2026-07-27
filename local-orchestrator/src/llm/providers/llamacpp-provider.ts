import {
  type LLMProvider,
  type ChatMessage,
  type ChatOptions,
  type LLMResponse,
} from "../provider.js";
import type { LLMConfig } from "../config.js";
import { parseToolCalls } from "../tool-parser.js";

export class LlamaCppProvider implements LLMProvider {
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.config.baseUrl}/health`, {
        method: "GET",
        signal: AbortSignal.timeout(5_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<LLMResponse> {
    const prompt = buildLlamaCppPrompt(messages);

    const body: Record<string, unknown> = {
      prompt,
      temperature: options?.temperature ?? this.config.temperature,
      n_predict: options?.maxTokens ?? this.config.maxTokens,
      stream: false,
    };

    if (options?.tools && options.tools.length > 0) {
      body.prompt = prompt + "\n\n" + buildToolInstruction(options.tools);
    }

    const timeoutMs = this.config.timeoutMs ?? 30_000;
    const signal = combineSignals(options?.signal, timeoutMs);

    const res = await fetch(`${this.config.baseUrl}/completion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`llama.cpp error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as LlamaCppResponse;
    const content = data.content ?? "";

    const toolCalls = parseToolCalls(content);

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: data.tokens_evaluated != null
        ? { promptTokens: data.tokens_evaluated, completionTokens: data.tokens_predicted ?? 0 }
        : undefined,
    };
  }
}

function buildLlamaCppPrompt(messages: ChatMessage[]): string {
  let prompt = "";
  for (const msg of messages) {
    if (msg.role === "system") {
      prompt += `<system>\n${msg.content}\n</system>\n\n`;
    } else if (msg.role === "user") {
      prompt += `<user>\n${msg.content}\n</user>\n\n`;
    } else if (msg.role === "assistant") {
      prompt += `<assistant>\n${msg.content}\n</assistant>\n\n`;
    } else if (msg.role === "tool") {
      prompt += `<tool_result name="${msg.name ?? "unknown"}">\n${msg.content}\n</tool_result>\n\n`;
    }
  }
  prompt += "<assistant>\n";
  return prompt;
}

function buildToolInstruction(tools: { function: { name: string; description: string; parameters: Record<string, unknown> } }[]): string {
  const toolDescs = tools
    .map((t) => `- ${t.function.name}: ${t.function.description}\n  Parameters: ${JSON.stringify(t.function.parameters)}`)
    .join("\n");

  return `Available tools:\n${toolDescs}\n\nTo use a tool, output a JSON block like:\n{"tool_calls":[{"name":"tool_name","arguments":{...}}]}`;
}

interface LlamaCppResponse {
  content?: string;
  tokens_evaluated?: number;
  tokens_predicted?: number;
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

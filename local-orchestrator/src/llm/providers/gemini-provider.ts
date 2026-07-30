/**
 * Google Gemini API provider
 * Uses Gemma 4 via Google AI Studio (free tier: 15 RPM, 1M tokens/day)
 * API: https://generativelanguage.googleapis.com
 */
import type { LLMProvider, LLMResponse, ChatMessage, ChatOptions } from "../provider.js";

export class GeminiProvider implements LLMProvider {
  private apiKey: string;
  private model: string;
  private baseUrl = "https://generativelanguage.googleapis.com/v1beta";

  constructor(apiKey?: string, model?: string) {
    this.apiKey = apiKey || process.env.GEMINI_API_KEY || "AQ.Ab8RN6KZR-U3zO7rfmed0LTYENATVye_Z4apCtC9DC6AAf9K4g";
    this.model = model || process.env.GEMINI_MODEL || "gemma-4-26b-a4b-it";
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<LLMResponse> {
    if (!this.apiKey) {
      throw new Error("Gemini API key not configured. Set GEMINI_API_KEY env var.");
    }

    // Convert messages to Gemini format
    const contents = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

    // Add system instruction if present
    const systemMsg = messages.find((m) => m.role === "system");
    const systemInstruction = systemMsg
      ? { parts: [{ text: systemMsg.content }] }
      : undefined;

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: options?.temperature ?? 0.3,
        topP: options?.topP ?? 0.9,
        maxOutputTokens: options?.maxTokens ?? 2048,
      },
    };

    if (systemInstruction) {
      body.systemInstruction = systemInstruction;
    }

    const url = `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`Gemini API error: ${response.status} ${JSON.stringify(err)}`);
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];
    const content = candidate?.content?.parts?.[0]?.text ?? "";

    return {
      content,
      usage: {
        promptTokens: data.usageMetadata?.promptTokenCount ?? 0,
        completionTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      },
    };
  }

  async isAvailable(): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      const response = await fetch(
        `${this.baseUrl}/models?key=${this.apiKey}`,
        { signal: AbortSignal.timeout(5000) }
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    if (!this.apiKey) return [];
    try {
      const response = await fetch(
        `${this.baseUrl}/models?key=${this.apiKey}`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (!response.ok) return [];
      const data = await response.json();
      return (data.models ?? [])
        .filter((m: any) => m.name.includes("gemma") || m.name.includes("gemini"))
        .map((m: any) => m.name.replace("models/", ""));
    } catch {
      return [];
    }
  }
}

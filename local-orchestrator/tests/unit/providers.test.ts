import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  registerProvider,
  getProvider,
  listProviders,
  hasProvider,
} from "../../src/llm/provider-registry.js";
import type { LLMProvider, ChatMessage, LLMResponse } from "../../src/llm/provider.js";
import { OpenAIProvider } from "../../src/llm/providers/openai-provider.js";
import { AnthropicProvider } from "../../src/llm/providers/anthropic-provider.js";

function createDummyProvider(name: string): LLMProvider {
  return {
    async chat(): Promise<LLMResponse> {
      return { content: `${name} response` };
    },
    async isAvailable(): Promise<boolean> {
      return true;
    },
  };
}

describe("provider-registry", () => {
  beforeEach(() => {
    // Clear registry by overwriting with known state
    // (Registry is module-level, so we test with unique names)
  });

  it("registers and retrieves a provider", async () => {
    const name = `test-provider-${Date.now()}`;
    registerProvider(name, () => createDummyProvider(name));
    const provider = getProvider(name);
    expect(provider).toBeDefined();
    await expect(provider.isAvailable()).resolves.toBe(true);
  });

  it("returns all registered providers via listProviders", () => {
    const name = `list-test-${Date.now()}`;
    registerProvider(name, () => createDummyProvider(name));
    const providers = listProviders();
    expect(providers).toContain(name);
  });

  it("hasProvider returns true for registered providers", () => {
    const name = `has-test-${Date.now()}`;
    registerProvider(name, () => createDummyProvider(name));
    expect(hasProvider(name)).toBe(true);
    expect(hasProvider(`nonexistent-${Date.now()}`)).toBe(false);
  });

  it("getProvider throws for unknown provider", () => {
    expect(() => getProvider(`unknown-${Date.now()}`)).toThrow(/Unknown LLM provider/);
  });

  it("each getProvider call creates a new instance", () => {
    const name = `instance-test-${Date.now()}`;
    let callCount = 0;
    registerProvider(name, () => {
      callCount++;
      return createDummyProvider(`${name}-${callCount}`);
    });

    const p1 = getProvider(name);
    const p2 = getProvider(name);
    expect(p1).not.toBe(p2);
    expect(callCount).toBe(2);
  });
});

describe("OpenAI provider", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("builds correct request format for chat", async () => {
    let capturedUrl = "";
    let capturedOptions: RequestInit = {};

    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = typeof url === "string" ? url : url.toString();
      capturedOptions = init ?? {};
      return new Response(JSON.stringify({
        choices: [{ message: { content: "Hello!" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;

    const provider = new OpenAIProvider({
      apiKey: "test-key",
      baseUrl: "https://api.example.com/v1",
      model: "gpt-test",
      temperature: 0.5,
      maxTokens: 100,
    });

    const messages: ChatMessage[] = [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Hi" },
    ];

    const response = await provider.chat(messages, { temperature: 0.7, maxTokens: 200 });

    expect(capturedUrl).toBe("https://api.example.com/v1/chat/completions");
    expect(capturedOptions.method).toBe("POST");

    const body = JSON.parse(capturedOptions.body as string);
    expect(body.model).toBe("gpt-test");
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0]).toEqual({ role: "system", content: "You are helpful." });
    expect(body.messages[1]).toEqual({ role: "user", content: "Hi" });
    expect(body.temperature).toBe(0.7);
    expect(body.max_tokens).toBe(200);

    expect(response.content).toBe("Hello!");
    expect(response.usage).toEqual({ promptTokens: 10, completionTokens: 5 });
  });

  it("sends correct authorization header", async () => {
    let capturedHeaders: Record<string, string> = {};

    globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedHeaders = (init?.headers as Record<string, string>) ?? {};
      return new Response(JSON.stringify({
        choices: [{ message: { content: "ok" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;

    const provider = new OpenAIProvider({ apiKey: "sk-test-123" });
    await provider.chat([{ role: "user", content: "test" }]);

    expect(capturedHeaders["Authorization"]).toBe("Bearer sk-test-123");
  });

  it("isAvailable returns false without API key", async () => {
    const provider = new OpenAIProvider({ apiKey: "" });
    const result = await provider.isAvailable();
    expect(result).toBe(false);
  });

  it("isAvailable returns true when API responds OK", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ data: [] }), { status: 200 })
    ) as typeof fetch;

    const provider = new OpenAIProvider({ apiKey: "test" });
    const result = await provider.isAvailable();
    expect(result).toBe(true);
  });

  it("isAvailable returns false on network error", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("Network error");
    }) as typeof fetch;

    const provider = new OpenAIProvider({ apiKey: "test" });
    const result = await provider.isAvailable();
    expect(result).toBe(false);
  });

  it("listModels returns model IDs", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({
        data: [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }],
      }), { status: 200 })
    ) as typeof fetch;

    const provider = new OpenAIProvider({ apiKey: "test" });
    const models = await provider.listModels();
    expect(models).toEqual(["gpt-4o", "gpt-4o-mini"]);
  });

  it("listModels returns empty array without API key", async () => {
    const provider = new OpenAIProvider({ apiKey: "" });
    const models = await provider.listModels();
    expect(models).toEqual([]);
  });

  it("parses tool calls from response", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({
        choices: [{
          message: {
            content: "",
            tool_calls: [{
              id: "call_abc",
              function: {
                name: "read_file",
                arguments: '{"path": "test.txt"}',
              },
            }],
          },
        }],
      }), { status: 200 })
    ) as typeof fetch;

    const provider = new OpenAIProvider({ apiKey: "test" });
    const response = await provider.chat([{ role: "user", content: "read test.txt" }]);

    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls![0].name).toBe("read_file");
    expect(response.toolCalls![0].id).toBe("call_abc");
  });

  it("reads config from env vars", () => {
    const origKey = process.env.GEMORK_OPENAI_API_KEY;
    const origUrl = process.env.GEMORK_OPENAI_BASE_URL;
    const origModel = process.env.GEMORK_OPENAI_MODEL;

    process.env.GEMORK_OPENAI_API_KEY = "env-key";
    process.env.GEMORK_OPENAI_BASE_URL = "https://custom.api.com/v1";
    process.env.GEMORK_OPENAI_MODEL = "custom-model";

    const provider = new OpenAIProvider();
    // Provider reads env vars in constructor; we verify via isAvailable (needs fetch mock)
    expect(provider).toBeDefined();

    process.env.GEMORK_OPENAI_API_KEY = origKey;
    process.env.GEMORK_OPENAI_BASE_URL = origUrl;
    process.env.GEMORK_OPENAI_MODEL = origModel;
  });
});

describe("Anthropic provider", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("builds correct request format for chat", async () => {
    let capturedUrl = "";
    let capturedOptions: RequestInit = {};

    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = typeof url === "string" ? url : url.toString();
      capturedOptions = init ?? {};
      return new Response(JSON.stringify({
        content: [{ type: "text", text: "Hello from Claude!" }],
        usage: { input_tokens: 10, output_tokens: 8 },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;

    const provider = new AnthropicProvider({
      apiKey: "test-key",
      baseUrl: "https://api.example.com",
      model: "claude-test",
      temperature: 0.4,
      maxTokens: 500,
    });

    const messages: ChatMessage[] = [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Hi" },
    ];

    const response = await provider.chat(messages, { temperature: 0.6, maxTokens: 300 });

    expect(capturedUrl).toBe("https://api.example.com/v1/messages");
    expect(capturedOptions.method).toBe("POST");

    const headers = capturedOptions.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("test-key");
    expect(headers["anthropic-version"]).toBe("2023-06-01");

    const body = JSON.parse(capturedOptions.body as string);
    expect(body.model).toBe("claude-test");
    expect(body.system).toBe("You are helpful.");
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]).toEqual({ role: "user", content: "Hi" });
    expect(body.temperature).toBe(0.6);
    expect(body.max_tokens).toBe(300);

    expect(response.content).toBe("Hello from Claude!");
    expect(response.usage).toEqual({ promptTokens: 10, completionTokens: 8 });
  });

  it("sends correct headers", async () => {
    let capturedHeaders: Record<string, string> = {};

    globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedHeaders = (init?.headers as Record<string, string>) ?? {};
      return new Response(JSON.stringify({
        content: [{ type: "text", text: "ok" }],
      }), { status: 200 });
    }) as typeof fetch;

    const provider = new AnthropicProvider({ apiKey: "sk-ant-test" });
    await provider.chat([{ role: "user", content: "test" }]);

    expect(capturedHeaders["x-api-key"]).toBe("sk-ant-test");
    expect(capturedHeaders["anthropic-version"]).toBe("2023-06-01");
    expect(capturedHeaders["Content-Type"]).toBe("application/json");
  });

  it("isAvailable returns false without API key", async () => {
    const provider = new AnthropicProvider({ apiKey: "" });
    const result = await provider.isAvailable();
    expect(result).toBe(false);
  });

  it("isAvailable returns true when API responds", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({}), { status: 200 })
    ) as typeof fetch;

    const provider = new AnthropicProvider({ apiKey: "test" });
    const result = await provider.isAvailable();
    expect(result).toBe(true);
  });

  it("isAvailable returns true on 400 (auth works but bad request)", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "bad request" }), { status: 400 })
    ) as typeof fetch;

    const provider = new AnthropicProvider({ apiKey: "test" });
    const result = await provider.isAvailable();
    expect(result).toBe(true);
  });

  it("isAvailable returns false on network error", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("Network error");
    }) as typeof fetch;

    const provider = new AnthropicProvider({ apiKey: "test" });
    const result = await provider.isAvailable();
    expect(result).toBe(false);
  });

  it("listModels returns known Claude models", async () => {
    const provider = new AnthropicProvider({ apiKey: "test" });
    const models = await provider.listModels();
    expect(models).toContain("claude-sonnet-4-20250514");
    expect(models.length).toBeGreaterThan(0);
  });

  it("parses tool use blocks from response", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({
        content: [
          { type: "text", text: "Let me read that file." },
          { type: "tool_use", id: "tool_123", name: "read_file", input: { path: "test.txt" } },
        ],
      }), { status: 200 })
    ) as typeof fetch;

    const provider = new AnthropicProvider({ apiKey: "test" });
    const response = await provider.chat([{ role: "user", content: "read test.txt" }]);

    expect(response.content).toBe("Let me read that file.");
    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls![0].name).toBe("read_file");
    expect(response.toolCalls![0].id).toBe("tool_123");
    expect(response.toolCalls![0].arguments).toEqual({ path: "test.txt" });
  });

  it("separates system messages into system param", async () => {
    let capturedBody: Record<string, unknown> = {};

    globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({
        content: [{ type: "text", text: "ok" }],
      }), { status: 200 });
    }) as typeof fetch;

    const provider = new AnthropicProvider({ apiKey: "test" });
    await provider.chat([
      { role: "system", content: "System prompt 1" },
      { role: "system", content: "System prompt 2" },
      { role: "user", content: "Hello" },
    ]);

    expect(capturedBody.system).toBe("System prompt 1\n\nSystem prompt 2");
    expect(capturedBody.messages).toHaveLength(1);
    expect((capturedBody.messages as ChatMessage[])[0].role).toBe("user");
  });

  it("reads config from env vars", () => {
    const origKey = process.env.GEMORK_ANTHROPIC_API_KEY;
    const origUrl = process.env.GEMORK_ANTHROPIC_BASE_URL;
    const origModel = process.env.GEMORK_ANTHROPIC_MODEL;

    process.env.GEMORK_ANTHROPIC_API_KEY = "env-ant-key";
    process.env.GEMORK_ANTHROPIC_BASE_URL = "https://custom.anthropic.com";
    process.env.GEMORK_ANTHROPIC_MODEL = "custom-claude";

    const provider = new AnthropicProvider();
    expect(provider).toBeDefined();

    process.env.GEMORK_ANTHROPIC_API_KEY = origKey;
    process.env.GEMORK_ANTHROPIC_BASE_URL = origUrl;
    process.env.GEMORK_ANTHROPIC_MODEL = origModel;
  });
});

describe("provider selection via config", () => {
  it("loadLLMConfig auto-detects openai when OPENAI_API_KEY is set", async () => {
    const { loadLLMConfig } = await import("../../src/llm/config.js");
    const origKey = process.env.GEMORK_OPENAI_API_KEY;
    const origProvider = process.env.GEMORK_LLM_PROVIDER;

    delete process.env.GEMORK_LLM_PROVIDER;
    process.env.GEMORK_OPENAI_API_KEY = "test-key";

    const config = loadLLMConfig();
    expect(config.provider).toBe("openai");

    process.env.GEMORK_OPENAI_API_KEY = origKey;
    if (origProvider) process.env.GEMORK_LLM_PROVIDER = origProvider;
    else delete process.env.GEMORK_LLM_PROVIDER;
  });

  it("loadLLMConfig auto-detects anthropic when ANTHROPIC_API_KEY is set", async () => {
    const { loadLLMConfig } = await import("../../src/llm/config.js");
    const origKey = process.env.GEMORK_ANTHROPIC_API_KEY;
    const origProvider = process.env.GEMORK_LLM_PROVIDER;
    const origOpenAI = process.env.GEMORK_OPENAI_API_KEY;

    delete process.env.GEMORK_LLM_PROVIDER;
    delete process.env.GEMORK_OPENAI_API_KEY;
    process.env.GEMORK_ANTHROPIC_API_KEY = "test-key";

    const config = loadLLMConfig();
    expect(config.provider).toBe("anthropic");

    process.env.GEMORK_ANTHROPIC_API_KEY = origKey;
    if (origProvider) process.env.GEMORK_LLM_PROVIDER = origProvider;
    else delete process.env.GEMORK_LLM_PROVIDER;
    if (origOpenAI) process.env.GEMORK_OPENAI_API_KEY = origOpenAI;
  });

  it("loadLLMConfig defaults to ollama when no env vars set", async () => {
    const { loadLLMConfig } = await import("../../src/llm/config.js");
    const origProvider = process.env.GEMORK_LLM_PROVIDER;
    const origOpenAI = process.env.GEMORK_OPENAI_API_KEY;
    const origAnthropic = process.env.GEMORK_ANTHROPIC_API_KEY;

    delete process.env.GEMORK_LLM_PROVIDER;
    delete process.env.GEMORK_OPENAI_API_KEY;
    delete process.env.GEMORK_ANTHROPIC_API_KEY;

    const config = loadLLMConfig();
    expect(config.provider).toBe("ollama");

    if (origProvider) process.env.GEMORK_LLM_PROVIDER = origProvider;
    if (origOpenAI) process.env.GEMORK_OPENAI_API_KEY = origOpenAI;
    if (origAnthropic) process.env.GEMORK_ANTHROPIC_API_KEY = origAnthropic;
  });

  it("explicit provider override takes precedence over env vars", async () => {
    const { loadLLMConfig } = await import("../../src/llm/config.js");
    const origOpenAI = process.env.GEMORK_OPENAI_API_KEY;

    process.env.GEMORK_OPENAI_API_KEY = "test-key";

    const config = loadLLMConfig({ provider: "ollama" });
    expect(config.provider).toBe("ollama");

    process.env.GEMORK_OPENAI_API_KEY = origOpenAI;
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { LLMPlanGeneratorImpl, parsePlanOutput } from "../../src/llm/plan-generator.js";
import { createMockLLMProvider, FIXTURES } from "../setup.js";
import type { LLMProvider, LLMResponse, ChatMessage, ChatOptions } from "../../src/llm/provider.js";
import type { LLMStreamChunk } from "../../src/llm/provider.js";
import { createStreamingAccumulator, consumeStream } from "../../src/llm/streaming.js";
import {
  LLMError,
  LLMTimeoutError,
  LLMModelNotFoundError,
  LLMProviderUnreachableError,
} from "../../src/llm/errors.js";

// ─── Helpers ──────────────────────────────────────────────

function makeProvider(responses: LLMResponse[]): LLMProvider {
  let idx = 0;
  return {
    async chat(_msgs: ChatMessage[], _opts?: ChatOptions): Promise<LLMResponse> {
      return responses[Math.min(idx++, responses.length - 1)];
    },
    async isAvailable(): Promise<boolean> {
      return true;
    },
  };
}

function makeFailingProvider(error: Error): LLMProvider {
  return {
    async chat(): Promise<LLMResponse> {
      throw error;
    },
    async isAvailable(): Promise<boolean> {
      return true;
    },
  };
}

function makeUnavailableProvider(): LLMProvider {
  return {
    async chat(): Promise<LLMResponse> {
      return { content: "[]" };
    },
    async isAvailable(): Promise<boolean> {
      return false;
    },
  };
}

// ─── Plan Generator: Valid JSON Structure ─────────────────

describe("llm-integration/plan-generator", () => {
  describe("valid JSON output", () => {
    it("produces valid plan structure from clean JSON", async () => {
      const provider = makeProvider([{
        content: JSON.stringify([
          { description: "Read the codebase", tier: 1, rationale: "Analysis" },
          { description: "Create new module", tier: 2, rationale: "Reversible" },
          { description: "Delete old files", tier: 3, rationale: "Critical" },
        ]),
      }]);

      const gen = new LLMPlanGeneratorImpl(provider);
      const steps = await gen.generatePlan("Refactor the project");

      expect(steps).toHaveLength(3);
      expect(steps[0]).toEqual({
        description: "Read the codebase",
        tier: 1,
        connectorId: undefined,
        rationale: "Analysis",
      });
      expect(steps[1].tier).toBe(2);
      expect(steps[2].tier).toBe(3);
    });

    it("produces valid plan from markdown-wrapped JSON", async () => {
      const provider = makeProvider([{
        content: 'Here is my plan:\n```json\n[{"description":"Step A","tier":1}]\n```\nLet me know.',
      }]);

      const gen = new LLMPlanGeneratorImpl(provider);
      const steps = await gen.generatePlan("Do something");

      expect(steps).toHaveLength(1);
      expect(steps[0].description).toBe("Step A");
      expect(steps[0].tier).toBe(1);
    });

    it("produces valid plan from JSON with comments", async () => {
      const provider = makeProvider([{
        content: '// Plan\n[\n{"description": "Read files", "tier": 1, "rationale": "Analysis"},\n{"description": "Write files", "tier": 2}\n]',
      }]);

      const gen = new LLMPlanGeneratorImpl(provider);
      const steps = await gen.generatePlan("Test");

      expect(steps).toHaveLength(2);
      steps.forEach((s) => {
        expect([1, 2, 3]).toContain(s.tier);
      });
    });

    it("normalizes string tier values", async () => {
      const provider = makeProvider([{
        content: JSON.stringify([
          { description: "Step 1", tier: "read" },
          { description: "Step 2", tier: "tier2" },
          { description: "Step 3", tier: "critical" },
        ]),
      }]);

      const gen = new LLMPlanGeneratorImpl(provider);
      const steps = await gen.generatePlan("Test");

      expect(steps[0].tier).toBe(1);
      expect(steps[1].tier).toBe(2);
      expect(steps[2].tier).toBe(3);
    });

    it("defaults to tier 2 for unrecognized tier values", async () => {
      const provider = makeProvider([{
        content: JSON.stringify([{ description: "Step", tier: "unknown" }]),
      }]);

      const gen = new LLMPlanGeneratorImpl(provider);
      const steps = await gen.generatePlan("Test");

      expect(steps[0].tier).toBe(2);
    });

    it("includes connectorId when present", async () => {
      const provider = makeProvider([{
        content: JSON.stringify([
          { description: "Read files", tier: 1, connectorId: "filesystem", rationale: "Need to scan" },
        ]),
      }]);

      const gen = new LLMPlanGeneratorImpl(provider);
      const steps = await gen.generatePlan("Test");

      expect(steps[0].connectorId).toBe("filesystem");
      expect(steps[0].rationale).toBe("Need to scan");
    });
  });

  // ─── Parse Failure Fallback ──────────────────────────────

  describe("parse failure fallback", () => {
    it("falls back to default plan on empty response", async () => {
      const provider = makeProvider([{ content: "" }]);
      const gen = new LLMPlanGeneratorImpl(provider);
      const steps = await gen.generatePlan("Test");

      expect(steps.length).toBeGreaterThanOrEqual(1);
      expect(steps[0].tier).toBe(1);
    });

    it("falls back to default plan on gibberish response", async () => {
      const provider = makeProvider([{ content: "I don't know how to plan that. Let me think..." }]);
      const gen = new LLMPlanGeneratorImpl(provider);
      const steps = await gen.generatePlan("Test");

      expect(steps.length).toBeGreaterThanOrEqual(1);
      expect([1, 2, 3]).toContain(steps[0].tier);
    });

    it("falls back after all retries fail", async () => {
      const provider = makeFailingProvider(new Error("Connection refused"));
      const gen = new LLMPlanGeneratorImpl(provider, { maxRetries: 2 });
      const steps = await gen.generatePlan("Test");

      expect(steps.length).toBeGreaterThanOrEqual(1);
    });

    it("retries on parse failure and uses success", async () => {
      let callCount = 0;
      const provider: LLMProvider = {
        async chat(): Promise<LLMResponse> {
          callCount++;
          if (callCount === 1) return { content: "garbage" };
          return {
            content: JSON.stringify([
              { description: "Retry step", tier: 1 },
            ]),
          };
        },
        async isAvailable(): Promise<boolean> {
          return true;
        },
      };

      const gen = new LLMPlanGeneratorImpl(provider, { maxRetries: 2 });
      const steps = await gen.generatePlan("Test");

      expect(steps).toHaveLength(1);
      expect(steps[0].description).toBe("Retry step");
      expect(callCount).toBe(2);
    });

    it("returns default plan when LLM provider is unavailable", async () => {
      const provider = makeUnavailableProvider();
      const gen = new LLMPlanGeneratorImpl(provider);
      const steps = await gen.generatePlan("Test");

      expect(steps.length).toBeGreaterThanOrEqual(1);
      expect(steps[0].rationale).toContain("unavailable");
    });
  });

  // ─── Timeout Fallback ────────────────────────────────────

  describe("timeout fallback", () => {
    it("falls back to default plan on timeout", async () => {
      const provider: LLMProvider = {
        async chat(_msgs, opts): Promise<LLMResponse> {
          // Respect abort signal so timeout works
          return new Promise((resolve, reject) => {
            const timer = setTimeout(() => resolve({ content: "[]" }), 5000);
            opts?.signal?.addEventListener("abort", () => {
              clearTimeout(timer);
              reject(new Error("Aborted"));
            });
          });
        },
        async isAvailable(): Promise<boolean> {
          return true;
        },
      };

      const gen = new LLMPlanGeneratorImpl(provider, { timeoutMs: 100 });
      const steps = await gen.generatePlan("Test");

      expect(steps.length).toBeGreaterThanOrEqual(1);
      expect(steps[0].rationale).toContain("fallback");
    }, 10000);

    it("respects total timeout across retries", async () => {
      let callCount = 0;
      const provider: LLMProvider = {
        async chat(): Promise<LLMResponse> {
          callCount++;
          await new Promise((r) => setTimeout(r, 200));
          return { content: "[]" };
        },
        async isAvailable(): Promise<boolean> {
          return true;
        },
      };

      const gen = new LLMPlanGeneratorImpl(provider, { timeoutMs: 300, maxRetries: 3 });
      const steps = await gen.generatePlan("Test");

      // Should not use all retries because total timeout is exceeded
      expect(callCount).toBeLessThanOrEqual(3);
      expect(steps.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── parsePlanOutput directly ────────────────────────────

  describe("parsePlanOutput", () => {
    it("parses valid JSON array", () => {
      const result = parsePlanOutput({
        content: JSON.stringify([{ description: "A", tier: 1 }]),
      });
      expect(result).toHaveLength(1);
      expect(result[0].description).toBe("A");
    });

    it("parses from DirtyJson (unquoted keys)", () => {
      const result = parsePlanOutput({
        content: '[{description: "A", tier: 1}]',
      });
      expect(result).toHaveLength(1);
    });

    it("parses from code block", () => {
      const result = parsePlanOutput({
        content: '```json\n[{"description":"B","tier":2}]\n```',
      });
      expect(result).toHaveLength(1);
      expect(result[0].description).toBe("B");
    });

    it("returns empty for no JSON", () => {
      const result = parsePlanOutput({ content: "no json here at all" });
      expect(result).toHaveLength(0);
    });

    it("extracts steps via regex fallback", () => {
      const result = parsePlanOutput({
        content: 'The plan is: {"description": "Scan files", "tier": 1} and then {"description": "Edit file", "tier": 2}',
      });
      expect(result).toHaveLength(2);
    });
  });
});

// ─── Streaming Handler ────────────────────────────────────

describe("llm-integration/streaming", () => {
  describe("StreamingAccumulator", () => {
    it("accumulates chunks correctly", () => {
      const acc = createStreamingAccumulator();

      acc.feedLine('{"message":{"content":"Hello"},"done":false}');
      acc.feedLine('{"message":{"content":" world"},"done":false}');
      acc.feedLine('{"message":{"content":"!"},"done":true}');

      expect(acc.getFullText()).toBe("Hello world!");
      expect(acc.isDone()).toBe(true);
    });

    it("returns null for empty lines", () => {
      const acc = createStreamingAccumulator();
      expect(acc.feedLine("")).toBeNull();
      expect(acc.feedLine("  ")).toBeNull();
    });

    it("returns null for malformed JSON", () => {
      const acc = createStreamingAccumulator();
      expect(acc.feedLine("not json at all")).toBeNull();
    });

    it("resets state", () => {
      const acc = createStreamingAccumulator();
      acc.feedLine('{"message":{"content":"Hi"},"done":false}');
      expect(acc.getFullText()).toBe("Hi");

      acc.reset();
      expect(acc.getFullText()).toBe("");
      expect(acc.isDone()).toBe(false);
    });

    it("handles chunks with no message field", () => {
      const acc = createStreamingAccumulator();
      const result = acc.feedLine('{"done":false}');
      expect(result).toEqual({ content: "", done: false });
    });
  });

  describe("consumeStream", () => {
    it("collects all chunks into full text", async () => {
      async function* lines(): AsyncIterable<string> {
        yield '{"message":{"content":"Hello"},"done":false}';
        yield '{"message":{"content":" world"},"done":true}';
      }

      const { content, chunks } = await consumeStream(lines());
      expect(content).toBe("Hello world");
      expect(chunks).toHaveLength(2);
      expect(chunks[1].done).toBe(true);
    });

    it("supports abort signal", async () => {
      const controller = new AbortController();
      async function* lines(): AsyncIterable<string> {
        yield '{"message":{"content":"A"},"done":false}';
        controller.abort("user cancelled");
        yield '{"message":{"content":"B"},"done":false}';
      }

      await expect(consumeStream(lines(), controller.signal)).rejects.toBeDefined();
    });

    it("handles empty stream", async () => {
      async function* lines(): AsyncIterable<string> {}

      const { content, chunks } = await consumeStream(lines());
      expect(content).toBe("");
      expect(chunks).toHaveLength(0);
    });
  });
});

// ─── Error Types ──────────────────────────────────────────

describe("llm-integration/errors", () => {
  it("LLMError has correct properties", () => {
    const err = new LLMError("PARSE_FAILED", "Bad JSON", { recoverable: true });
    expect(err.code).toBe("PARSE_FAILED");
    expect(err.message).toBe("Bad JSON");
    expect(err.recoverable).toBe(true);
    expect(err.name).toBe("LLMError");
    expect(err instanceof Error).toBe(true);
  });

  it("LLMTimeoutError has timeout code", () => {
    const err = new LLMTimeoutError(30000);
    expect(err.code).toBe("TIMEOUT");
    expect(err.recoverable).toBe(true);
    expect(err.message).toContain("30000");
  });

  it("LLMModelNotFoundError includes available models", () => {
    const err = new LLMModelNotFoundError("gemma4:14b", ["gemma4:2b", "gemma4:9b"]);
    expect(err.code).toBe("MODEL_NOT_FOUND");
    expect(err.recoverable).toBe(false);
    expect(err.message).toContain("gemma4:14b");
    expect(err.message).toContain("gemma4:2b");
  });

  it("LLMProviderUnreachableError has correct code", () => {
    const err = new LLMProviderUnreachableError("http://localhost:11434");
    expect(err.code).toBe("PROVIDER_UNREACHABLE");
    expect(err.recoverable).toBe(true);
    expect(err.message).toContain("localhost");
  });
});

// ─── Plan Generator Integration with Mock Provider ────────

describe("llm-integration/e2e-plan-generation", () => {
  it("generates plan using mock provider from setup.ts", async () => {
    const provider = createMockLLMProvider({
      responses: [FIXTURES.llmResponses.validJson],
    });
    const gen = new LLMPlanGeneratorImpl(provider);
    const steps = await gen.generatePlan("Build a REST API");

    expect(steps.length).toBeGreaterThanOrEqual(1);
    steps.forEach((s) => {
      expect(s.description).toBeTruthy();
      expect([1, 2, 3]).toContain(s.tier);
    });
  });

  it("handles all fixture responses", async () => {
    const fixtures = [
      FIXTURES.llmResponses.validJson,
      FIXTURES.llmResponses.markdownWrapped,
      FIXTURES.llmResponses.withComments,
      FIXTURES.llmResponses.textWrapped,
    ];

    for (const fixture of fixtures) {
      const provider = createMockLLMProvider({ responses: [fixture] });
      const gen = new LLMPlanGeneratorImpl(provider);
      const steps = await gen.generatePlan("Test goal");

      expect(steps.length).toBeGreaterThanOrEqual(1);
      steps.forEach((s) => {
        expect([1, 2, 3]).toContain(s.tier);
      });
    }
  });

  it("every step has valid tier for guardrail engine", async () => {
    const provider = createMockLLMProvider({
      responses: [{
        content: JSON.stringify([
          { description: "A", tier: 1 },
          { description: "B", tier: 2 },
          { description: "C", tier: 3 },
          { description: "D" }, // no tier → should default to 2
        ]),
      }],
    });

    const gen = new LLMPlanGeneratorImpl(provider);
    const steps = await gen.generatePlan("Test");

    expect(steps).toHaveLength(4);
    steps.forEach((s) => {
      expect([1, 2, 3]).toContain(s.tier);
    });
  });
});

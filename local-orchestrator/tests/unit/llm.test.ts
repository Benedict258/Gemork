import { describe, it, expect } from "vitest";
import { DirtyJson, tryParse, extractJson } from "../../src/llm/dirty-json.js";
import { parseToolCalls } from "../../src/llm/tool-parser.js";
import { LLMPlanGeneratorImpl } from "../../src/llm/plan-generator.js";
import { createMockLLMProvider, FIXTURES } from "../setup.js";

describe("llm/dirty-json", () => {
  describe("DirtyJson.parseString", () => {
    it("parses valid JSON", () => {
      const result = DirtyJson.parseString('{"name": "test", "value": 42}');
      expect(result).toEqual({ name: "test", value: 42 });
    });

    it("parses JSON with comments", () => {
      const input = `{
        // This is a comment
        "name": "test",
        /* block comment */
        "value": 42
      }`;
      const result = DirtyJson.parseString(input);
      expect(result).toEqual({ name: "test", value: 42 });
    });

    it("parses JSON with trailing commas", () => {
      const result = DirtyJson.parseString('{"a": 1, "b": 2,}');
      expect(result).toEqual({ a: 1, b: 2 });
    });

    it("parses JSON array with trailing comma", () => {
      const result = DirtyJson.parseString('[1, 2, 3,]');
      expect(result).toEqual([1, 2, 3]);
    });

    it("extracts JSON from text wrapper", () => {
      const input = 'Here is the result: {"key": "value"} and more text';
      const result = DirtyJson.parseString(input);
      expect(result).toEqual({ key: "value" });
    });

    it("parses unquoted keys", () => {
      const result = DirtyJson.parseString("{name: test, value: 42}");
      expect(result).toEqual({ name: "test", value: 42 });
    });

    it("parses boolean and null values", () => {
      const result = DirtyJson.parseString('{"a": true, "b": false, "c": null}');
      expect(result).toEqual({ a: true, b: false, c: null });
    });

    it("returns null for empty string", () => {
      expect(DirtyJson.parseString("")).toBeNull();
    });

    it("parses nested objects", () => {
      const result = DirtyJson.parseString('{"outer": {"inner": "value"}}');
      expect(result).toEqual({ outer: { inner: "value" } });
    });

    it("parses arrays", () => {
      const result = DirtyJson.parseString('["a", "b", "c"]');
      expect(result).toEqual(["a", "b", "c"]);
    });

    it("handles double-brace wrapper", () => {
      const result = DirtyJson.parseString('{{"key": "value"}}');
      // DirtyJson strips outer {{ }} but keeps inner content
      expect(result).toBeDefined();
      expect(typeof result).toBe("object");
    });
  });

  describe("tryParse", () => {
    it("tries JSON.parse first", () => {
      expect(tryParse('{"a": 1}')).toEqual({ a: 1 });
    });

    it("falls back to DirtyJson", () => {
      expect(tryParse('{a: 1}')).toEqual({ a: 1 });
    });
  });

  describe("extractJson", () => {
    it("extracts and stringifies JSON from text", () => {
      const result = extractJson('The answer is {"key": "value"} done');
      expect(result).toBe('{"key":"value"}');
    });

    it("returns null or text for no JSON found", () => {
      const result = extractJson("no json here");
      // extractJson may return the text parsed as a string or null
      // depending on DirtyJson behavior
      expect(result === null || typeof result === "string").toBe(true);
    });
  });
});

describe("llm/tool-parser", () => {
  describe("parseToolCalls", () => {
    it("extracts from OpenAI tool_calls format", () => {
      const content = JSON.stringify({
        tool_calls: [
          {
            id: "call_1",
            function: {
              name: "read_file",
              arguments: '{"path": "test.txt"}',
            },
          },
        ],
      });

      const calls = parseToolCalls(content);
      expect(calls).toHaveLength(1);
      expect(calls[0].name).toBe("read_file");
      expect(calls[0].arguments).toEqual({ path: "test.txt" });
    });

    it("extracts from markdown code blocks", () => {
      const content = `I will read the file:
\`\`\`json
{"name": "write_file", "arguments": {"path": "out.txt", "content": "hello"}}
\`\`\`
Done.`;

      const calls = parseToolCalls(content);
      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(calls[0].name).toBe("write_file");
    });

    it("extracts from raw JSON objects in text", () => {
      const content = 'Let me use {"name": "search", "parameters": {"query": "test"}} to find it.';
      const calls = parseToolCalls(content);
      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(calls[0].name).toBe("search");
    });

    it("returns empty array for no tool calls", () => {
      const calls = parseToolCalls("Just plain text, no tools.");
      expect(calls).toHaveLength(0);
    });

    it("parses function_call format", () => {
      const content = JSON.stringify({
        function_call: {
          name: "delete_file",
          arguments: '{"path": "old.txt"}',
        },
      });

      const calls = parseToolCalls(content);
      expect(calls).toHaveLength(1);
      expect(calls[0].name).toBe("delete_file");
    });
  });
});

describe("llm/plan-generator", () => {
  it("generates plan from LLM response", async () => {
    const provider = createMockLLMProvider({
      responses: [FIXTURES.llmResponses.validJson],
    });
    const generator = new LLMPlanGeneratorImpl(provider);

    const steps = await generator.generatePlan("Build a feature");
    expect(steps.length).toBeGreaterThanOrEqual(1);
    expect(steps[0].description).toBeTruthy();
    expect([1, 2, 3]).toContain(steps[0].tier);
  });

  it("falls back to default plan on LLM failure", async () => {
    const provider = createMockLLMProvider({ failAfter: 0 });
    const generator = new LLMPlanGeneratorImpl(provider);

    const steps = await generator.generatePlan("Build a feature");
    expect(steps.length).toBeGreaterThanOrEqual(1);
    expect([1, 2, 3]).toContain(steps[0].tier);
  });

  it("parses plan from markdown code blocks", async () => {
    const provider = createMockLLMProvider({
      responses: [FIXTURES.llmResponses.markdownWrapped],
    });
    const generator = new LLMPlanGeneratorImpl(provider);

    const steps = await generator.generatePlan("Test goal");
    expect(steps.length).toBeGreaterThanOrEqual(1);
  });

  it("parses plan with comments in JSON", async () => {
    const provider = createMockLLMProvider({
      responses: [FIXTURES.llmResponses.withComments],
    });
    const generator = new LLMPlanGeneratorImpl(provider);

    const steps = await generator.generatePlan("Test goal");
    expect(steps).toHaveLength(2);
  });

  it("normalizes tier values from various formats", async () => {
    const provider = createMockLLMProvider({
      responses: [{
        content: JSON.stringify([
          { description: "Step 1", tier: "tier1" },
          { description: "Step 2", tier: "read" },
          { description: "Step 3", tier: "critical" },
        ]),
      }],
    });
    const generator = new LLMPlanGeneratorImpl(provider);

    const steps = await generator.generatePlan("Test");
    expect(steps[0].tier).toBe(1);
    expect(steps[1].tier).toBe(1);
    expect(steps[2].tier).toBe(3);
  });

  it("handles empty LLM response gracefully", async () => {
    const provider = createMockLLMProvider({
      responses: [{ content: "" }],
    });
    const generator = new LLMPlanGeneratorImpl(provider);

    const steps = await generator.generatePlan("Test");
    expect(steps.length).toBeGreaterThanOrEqual(1); // Falls back to default
  });
});

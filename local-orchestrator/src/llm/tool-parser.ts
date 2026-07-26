import { type ToolCall } from "./provider.js";
import { DirtyJson, tryParse } from "./dirty-json.js";

let toolIdCounter = 0;

function nextToolId(): string {
  return `call_${Date.now()}_${++toolIdCounter}`;
}

/**
 * Parse tool calls from LLM output.
 * Handles: OpenAI-style function_call, JSON-in-text, markdown code blocks.
 */
export function parseToolCalls(content: string): ToolCall[] {
  const calls: ToolCall[] = [];

  // 1. Try OpenAI-style tool_calls array in JSON
  const openAiCalls = parseOpenAIToolCalls(content);
  if (openAiCalls.length > 0) return openAiCalls;

  // 2. Try function_call field in JSON
  const funcCall = parseFunctionCall(content);
  if (funcCall) return [funcCall];

  // 3. Try extracting from markdown code blocks
  const codeBlockCalls = parseFromCodeBlocks(content);
  if (codeBlockCalls.length > 0) return codeBlockCalls;

  // 4. Try raw JSON objects in text
  const rawCalls = parseRawJsonToolCalls(content);
  if (rawCalls.length > 0) return rawCalls;

  return calls;
}

function parseOpenAIToolCalls(content: string): ToolCall[] {
  const parsed = tryParseObj(content);
  if (!parsed) return [];

  const toolCalls = (parsed as Record<string, unknown>).tool_calls;
  if (!Array.isArray(toolCalls)) return [];

  return toolCalls
    .map((tc: Record<string, unknown>) => {
      const fn = tc.function as Record<string, unknown> | undefined;
      if (!fn) return null;
      const args = typeof fn.arguments === "string" ? tryParseObj(fn.arguments) : fn.arguments;
      return {
        id: (tc.id as string) || nextToolId(),
        name: fn.name as string,
        arguments: (args as Record<string, unknown>) ?? {},
      };
    })
    .filter(Boolean) as ToolCall[];
}

function parseFunctionCall(content: string): ToolCall | null {
  const parsed = tryParseObj(content);
  if (!parsed) return null;

  const fc = (parsed as Record<string, unknown>).function_call as Record<string, unknown> | undefined;
  if (!fc) return null;

  const args = typeof fc.arguments === "string" ? tryParseObj(fc.arguments) : fc.arguments;
  return {
    id: nextToolId(),
    name: fc.name as string,
    arguments: (args as Record<string, unknown>) ?? {},
  };
}

function parseFromCodeBlocks(content: string): ToolCall[] {
  const calls: ToolCall[] = [];
  const blockRegex = /```(?:json)?\s*\n?([\s\S]*?)\n?```/g;
  let match: RegExpExecArray | null;

  while ((match = blockRegex.exec(content)) !== null) {
    const block = match[1].trim();
    const found = parseRawJsonToolCalls(block);
    calls.push(...found);
  }

  return calls;
}

function parseRawJsonToolCalls(content: string): ToolCall[] {
  const calls: ToolCall[] = [];

  // Find JSON objects that look like tool calls
  const jsonRegex = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g;
  let match: RegExpExecArray | null;

  while ((match = jsonRegex.exec(content)) !== null) {
    const obj = tryParseObj(match[0]);
    if (!obj) continue;

    const rec = obj as Record<string, unknown>;
    if (typeof rec.name === "string" && (rec.arguments || rec.parameters || rec.input)) {
      const args = rec.arguments ?? rec.parameters ?? rec.input;
      const parsed = typeof args === "string" ? tryParseObj(args) : args;
      calls.push({
        id: nextToolId(),
        name: rec.name,
        arguments: (parsed as Record<string, unknown>) ?? {},
      });
    }
  }

  return calls;
}

function tryParseObj(s: unknown): unknown {
  if (typeof s !== "string") return null;
  return tryParse(s);
}

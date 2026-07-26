import type { LLMStreamChunk } from "./provider.js";

/**
 * Accumulates streaming NDJSON chunks from Ollama into a full response.
 * Supports abort/cancel for long-running generations.
 */
export interface StreamingAccumulator {
  /** Feed a raw NDJSON line. Returns the parsed chunk or null if incomplete. */
  feedLine(line: string): LLMStreamChunk | null;
  /** Get the full accumulated text. */
  getFullText(): string;
  /** Whether the stream is done. */
  isDone(): boolean;
  /** Reset the accumulator. */
  reset(): void;
}

export function createStreamingAccumulator(): StreamingAccumulator {
  let fullText = "";
  let done = false;

  return {
    feedLine(line: string): LLMStreamChunk | null {
      const trimmed = line.trim();
      if (!trimmed) return null;

      try {
        const parsed = JSON.parse(trimmed) as OllamaStreamResponse;
        const content = parsed.message?.content ?? "";
        fullText += content;
        done = parsed.done ?? false;
        return { content, done };
      } catch {
        return null;
      }
    },
    getFullText(): string {
      return fullText;
    },
    isDone(): boolean {
      return done;
    },
    reset(): void {
      fullText = "";
      done = false;
    },
  };
}

/**
 * Consume an async iterable of NDJSON lines into a full response.
 * Supports abort via AbortSignal.
 */
export async function consumeStream(
  lineIterable: AsyncIterable<string>,
  signal?: AbortSignal,
): Promise<{ content: string; chunks: LLMStreamChunk[] }> {
  const acc = createStreamingAccumulator();
  const chunks: LLMStreamChunk[] = [];

  for await (const line of lineIterable) {
    if (signal?.aborted) throw signal.reason ?? new Error("Stream aborted");
    const chunk = acc.feedLine(line);
    if (chunk) {
      chunks.push(chunk);
      if (chunk.done) break;
    }
  }

  return { content: acc.getFullText(), chunks };
}

/**
 * Create an async iterable from a fetch Response body (NDJSON streaming).
 * Handles the ReadableStream<Uint8Array> -> string line conversion.
 */
export async function* responseToLineIterable(
  response: Response,
): AsyncIterable<string> {
  const reader = response.body?.getReader();
  if (!reader) return;

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
        yield line;
      }
    }

    if (buffer.trim()) {
      yield buffer;
    }
  } finally {
    reader.releaseLock();
  }
}

interface OllamaStreamResponse {
  message?: {
    content?: string;
  };
  done?: boolean;
}

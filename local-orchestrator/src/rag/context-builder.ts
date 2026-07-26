import type { RagContext } from "./rag-retriever.js";

const MAX_TOKENS = 2000;
const CHARS_PER_TOKEN = 4;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function truncate(text: string, maxTokens: number): string {
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 3) + "...";
}

export function buildRagPromptSection(ragContext: RagContext): string {
  if (!ragContext) return "";

  const sections: string[] = [];
  let usedTokens = 0;

  sections.push("--- PROJECT CONTEXT (from RAG) ---");
  usedTokens += estimateTokens(sections[0]);

  // Recent agent actions
  if (ragContext.relevantMemory.length > 0) {
    const header = "\nRecent Agent Actions:";
    sections.push(header);
    usedTokens += estimateTokens(header);

    for (const entry of ragContext.relevantMemory.slice(0, 5)) {
      const line = `  - [${entry.metadata.agentId ?? "unknown"}] ${entry.metadata.action ?? entry.content}`;
      const truncated = truncate(line, Math.max(50, MAX_TOKENS - usedTokens));
      sections.push(truncated);
      usedTokens += estimateTokens(truncated);

      if (usedTokens >= MAX_TOKENS * 0.8) break;
    }
  }

  // Relevant file summaries
  if (ragContext.relevantFiles.length > 0 && usedTokens < MAX_TOKENS * 0.8) {
    const header = "\nRelevant Files:";
    sections.push(header);
    usedTokens += estimateTokens(header);

    for (const file of ragContext.relevantFiles.slice(0, 3)) {
      const snippet = truncate(file.content, 100);
      const line = `  - ${file.filePath}: ${snippet}`;
      const truncated = truncate(line, Math.max(50, MAX_TOKENS - usedTokens));
      sections.push(truncated);
      usedTokens += estimateTokens(truncated);

      if (usedTokens >= MAX_TOKENS * 0.8) break;
    }
  }

  // Similar past plans
  if (ragContext.relevantPlans.length > 0 && usedTokens < MAX_TOKENS * 0.8) {
    const header = "\nSimilar Past Plans:";
    sections.push(header);
    usedTokens += estimateTokens(header);

    for (const plan of ragContext.relevantPlans.slice(0, 3)) {
      const snippet = truncate(plan.content, 120);
      const line = `  - Plan ${plan.planId}: ${snippet}`;
      const truncated = truncate(line, Math.max(50, MAX_TOKENS - usedTokens));
      sections.push(truncated);
      usedTokens += estimateTokens(truncated);

      if (usedTokens >= MAX_TOKENS * 0.8) break;
    }
  }

  sections.push("--- END PROJECT CONTEXT ---\n");
  usedTokens += estimateTokens(sections[sections.length - 1]);

  return sections.join("\n");
}

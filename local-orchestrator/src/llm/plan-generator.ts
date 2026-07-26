import type { LLMProvider, LLMResponse } from "./provider.js";
import type { LLMPlanOutput } from "../orchestrator/task-engine.js";
import type { StepTier } from "../orchestrator/plan.js";
import { DirtyJson } from "./dirty-json.js";
import type { RagContext } from "../rag/rag-retriever.js";
import { buildRagPromptSection } from "../rag/context-builder.js";

const PLAN_SYSTEM_PROMPT = `You are a task planner for an autonomous AI agent. Given a goal, decompose it into ordered steps.

Each step must include:
- description: what this step does
- tier: 1 (read-only/analysis), 2 (reversible writes), or 3 (critical/irreversible writes requiring human approval)
- rationale: why this tier was chosen
- connectorId (optional): which connector to use (e.g., "filesystem", "browser", "code")

Return a JSON array of steps. Example:
[
  {"description":"Analyze the codebase","tier":1,"rationale":"Read-only analysis"},
  {"description":"Create the new module","tier":2,"rationale":"Reversible file creation"},
  {"description":"Update production config","tier":3,"rationale":"Critical change requiring approval"}
]

Rules:
- Tier 1: reading, searching, analyzing, planning
- Tier 2: creating files, editing code, running dev tools, reversible changes
- Tier 3: deleting files, deploying, modifying configs, irreversible changes
- Return ONLY the JSON array, no other text`;

export class LLMPlanGeneratorImpl {
  private provider: LLMProvider;

  constructor(provider: LLMProvider) {
    this.provider = provider;
  }

  async generatePlan(goal: string, ragContext?: RagContext): Promise<LLMPlanOutput[]> {
    try {
      const systemContent = ragContext
        ? `${PLAN_SYSTEM_PROMPT}\n\n${buildRagPromptSection(ragContext)}`
        : PLAN_SYSTEM_PROMPT;

      const response = await this.provider.chat([
        { role: "system", content: systemContent },
        { role: "user", content: `Goal: ${goal}` },
      ], { temperature: 0.3 });

      const steps = parsePlanOutput(response);
      if (steps.length > 0) return steps;
    } catch (err) {
      console.error("[plan-generator] LLM call failed, using fallback:", err);
    }

    return [
      {
        description: "Analyze goal and gather context",
        tier: 1 as StepTier,
        rationale: "Read-only analysis to understand scope",
      },
    ];
  }
}

function parsePlanOutput(response: LLMResponse): LLMPlanOutput[] {
  const content = response.content.trim();
  if (!content) return [];

  // Try direct JSON parse first
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) return normalizeSteps(parsed);
  } catch {}

  // Try DirtyJson for tolerant parsing
  const dirty = DirtyJson.parseString(content);
  if (Array.isArray(dirty)) return normalizeSteps(dirty);

  // Try extracting JSON from markdown code blocks
  const blockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (blockMatch) {
    try {
      const parsed = JSON.parse(blockMatch[1].trim());
      if (Array.isArray(parsed)) return normalizeSteps(parsed);
    } catch {}
    const dirtyBlock = DirtyJson.parseString(blockMatch[1].trim());
    if (Array.isArray(dirtyBlock)) return normalizeSteps(dirtyBlock);
  }

  // Try finding JSON array in text
  const arrayMatch = content.match(/\[[\s\S]*?\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) return normalizeSteps(parsed);
    } catch {}
    const dirtyArr = DirtyJson.parseString(arrayMatch[0]);
    if (Array.isArray(dirtyArr)) return normalizeSteps(dirtyArr);
  }

  return [];
}

function normalizeSteps(raw: unknown[]): LLMPlanOutput[] {
  return raw
    .filter((item): item is Record<string, unknown> =>
      typeof item === "object" && item !== null && !Array.isArray(item)
    )
    .map((item) => ({
      description: String(item.description ?? item.step ?? item.action ?? "Unnamed step"),
      tier: normalizeTier(item.tier ?? item.level ?? item.priority),
      connectorId: typeof item.connectorId === "string" ? item.connectorId : undefined,
      rationale: typeof item.rationale === "string" ? item.rationale : undefined,
    }));
}

function normalizeTier(raw: unknown): StepTier {
  if (raw === 1 || raw === "1" || raw === "tier1" || raw === "read" || raw === "readonly") return 1;
  if (raw === 3 || raw === "3" || raw === "tier3" || raw === "critical" || raw === "danger") return 3;
  return 2;
}

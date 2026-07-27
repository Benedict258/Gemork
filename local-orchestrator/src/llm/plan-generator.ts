import type { LLMProvider, LLMResponse } from "./provider.js";
import type { LLMPlanOutput } from "../orchestrator/task-engine.js";
import type { StepTier } from "../orchestrator/plan.js";
import { DirtyJson } from "./dirty-json.js";
import type { RagContext } from "../rag/rag-retriever.js";
import { buildRagPromptSection } from "../rag/context-builder.js";

const PLAN_SYSTEM_PROMPT = `You are a task planner for an autonomous AI agent called Gemork. Given a goal, decompose it into ordered steps.

Each step MUST include:
- description: what this step does (concise, actionable)
- tier: exactly 1, 2, or 3 (see rules below)
- rationale: why this tier was chosen
- connectorId (optional): which connector to use (e.g., "filesystem", "browser", "code")

TIER RULES:
- Tier 1 (READ-ONLY): reading, searching, analyzing, planning, research, listing files, searching code
- Tier 2 (REVERSIBLE): creating files, editing code, running dev tools, installing packages, reversible changes
- Tier 3 (CRITICAL): deleting files, deploying, modifying production configs, irreversible changes, running rm, dropping databases

Return ONLY a JSON array. No markdown, no explanation, no preamble.

Example format:
[{"description":"Analyze the codebase structure","tier":1,"rationale":"Read-only analysis to understand scope","connectorId":"filesystem"},{"description":"Create the new module file","tier":2,"rationale":"Reversible file creation"}]

IMPORTANT:
- Return ONLY the JSON array
- Every step MUST have tier 1, 2, or 3
- Do NOT wrap in markdown code blocks
- Do NOT add any text before or after the JSON`;

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 500;

export interface PlanGeneratorConfig {
  timeoutMs?: number;
  maxRetries?: number;
}

export class LLMPlanGeneratorImpl {
  private provider: LLMProvider;
  private config: PlanGeneratorConfig;

  constructor(provider: LLMProvider, config?: PlanGeneratorConfig) {
    this.provider = provider;
    this.config = {
      timeoutMs: config?.timeoutMs ?? 30_000,
      maxRetries: config?.maxRetries ?? MAX_RETRIES,
    };
  }

  async generatePlan(goal: string, ragContext?: RagContext): Promise<LLMPlanOutput[]> {
    const timeoutMs = this.config.timeoutMs!;
    const startTime = Date.now();

    // Sanitize goal to prevent prompt injection
    const sanitizedGoal = this.sanitizeGoal(goal);

    // Check if provider is available before attempting
    const available = await this.provider.isAvailable().catch(() => false);
    if (!available) {
      console.warn("[plan-generator] LLM provider unavailable, returning default plan");
      return this.defaultPlan(sanitizedGoal, "LLM provider unavailable");
    }

    const systemContent = ragContext
      ? `${PLAN_SYSTEM_PROMPT}\n\n${buildRagPromptSection(ragContext)}`
      : PLAN_SYSTEM_PROMPT;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.config.maxRetries!; attempt++) {
      try {
        const elapsed = Date.now() - startTime;
        const remaining = timeoutMs - elapsed;
        if (remaining <= 0) {
          console.warn(`[plan-generator] Timeout after ${elapsed}ms, returning default plan`);
          return this.defaultPlan(goal, "LLM request timed out");
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(new Error(`Timeout after ${remaining}ms`)), remaining);

        const response = await this.provider.chat(
          [
            { role: "system", content: systemContent },
            { role: "user", content: `Goal: ${goal}` },
          ],
          {
            temperature: 0.3,
            topP: 0.9,
            signal: controller.signal,
          },
        );

        clearTimeout(timer);

        const elapsed2 = Date.now() - startTime;
        console.log(`[plan-generator] LLM responded in ${elapsed2}ms (attempt ${attempt + 1})`);

        const steps = parsePlanOutput(response);
        if (steps.length > 0) {
          console.log(`[plan-generator] Parsed ${steps.length} steps from LLM output`);
          return steps;
        }

        console.warn(`[plan-generator] No valid steps parsed from LLM output (attempt ${attempt + 1})`);
        lastError = new Error("No valid steps parsed from LLM output");
      } catch (err) {
        const elapsed = Date.now() - startTime;
        const error = err instanceof Error ? err : new Error(String(err));
        console.error(`[plan-generator] LLM call failed (attempt ${attempt + 1}, ${elapsed}ms):`, error.message);
        lastError = error;

        // If timeout already exceeded total, don't retry
        if (elapsed >= timeoutMs) break;

        // Wait before retry
        if (attempt < this.config.maxRetries!) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
        }
      }
    }

    // All retries exhausted
    const reason = lastError?.message ?? "Unknown error";
    console.warn(`[plan-generator] All retries exhausted, returning default plan: ${reason}`);
    return this.defaultPlan(goal, reason);
  }

  private defaultPlan(goal: string, reason: string): LLMPlanOutput[] {
    return [
      {
        description: `Analyze goal: ${goal}`,
        tier: 1 as StepTier,
        rationale: `Read-only analysis (fallback: ${reason})`,
      },
      {
        description: "Identify required resources and files",
        tier: 1 as StepTier,
        rationale: "Gather context before making changes",
      },
      {
        description: "Implement the requested changes",
        tier: 2 as StepTier,
        rationale: "Reversible implementation based on analysis",
      },
    ];
  }

  private sanitizeGoal(goal: string): string {
    // Strip potential prompt injection patterns
    let sanitized = goal
      .replace(/```[\s\S]*?```/g, "[code block removed]")
      .replace(/\[INST\]/g, "").replace(/\[\/INST\]/g, "")
      .replace(/<<SYS>>/g, "").replace(/<\/<SYS>>/g, "")
      .replace(/ignore (all |any )?(previous|above|prior) (instructions?|prompts?|rules?)/gi, "[filtered]")
      .replace(/you are now|pretend to be|act as|roleplay as/gi, "[filtered]")
      .replace(/system prompt|assistant prompt/gi, "[filtered]")
      .trim();

    // Enforce max length (500 chars for goals)
    if (sanitized.length > 500) {
      sanitized = sanitized.substring(0, 500);
    }

    return sanitized || "Untitled task";
  }
}

export function parsePlanOutput(response: LLMResponse): LLMPlanOutput[] {
  const content = response.content.trim();
  if (!content) return [];

  // 1. Try direct JSON parse
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) return normalizeSteps(parsed);
  } catch {}

  // 2. Try DirtyJson for tolerant parsing
  try {
    const dirty = DirtyJson.parseString(content);
    if (Array.isArray(dirty)) return normalizeSteps(dirty);
  } catch {}

  // 3. Try extracting from markdown code blocks
  const blockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (blockMatch) {
    try {
      const parsed = JSON.parse(blockMatch[1].trim());
      if (Array.isArray(parsed)) return normalizeSteps(parsed);
    } catch {}
    try {
      const dirtyBlock = DirtyJson.parseString(blockMatch[1].trim());
      if (Array.isArray(dirtyBlock)) return normalizeSteps(dirtyBlock);
    } catch {}
  }

  // 4. Try finding JSON array in text (greedy match)
  const arrayMatch = content.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) return normalizeSteps(parsed);
    } catch {}
    try {
      const dirtyArr = DirtyJson.parseString(arrayMatch[0]);
      if (Array.isArray(dirtyArr)) return normalizeSteps(dirtyArr);
    } catch {}
  }

  // 5. Regex extraction: find step-like objects
  const steps = extractStepsViaRegex(content);
  if (steps.length > 0) return steps;

  return [];
}

function extractStepsViaRegex(content: string): LLMPlanOutput[] {
  const steps: LLMPlanOutput[] = [];
  // Match objects with description and tier fields
  const stepRegex = /\{[^{}]*"(?:description|step|action)"\s*:\s*"[^"]*"[^{}]*"(?:tier|level|priority)"\s*:\s*[123][^{}]*\}/gi;
  let match: RegExpExecArray | null;

  while ((match = stepRegex.exec(content)) !== null) {
    try {
      const parsed = DirtyJson.parseString(match[0]);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const steps1 = normalizeSteps([parsed]);
        if (steps1.length > 0) steps.push(steps1[0]);
      }
    } catch {}
  }

  return steps;
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
    }))
    .filter((step) => step.description !== "Unnamed step");
}

function normalizeTier(raw: unknown): StepTier {
  if (raw === 1 || raw === "1" || raw === "tier1" || raw === "read" || raw === "readonly") return 1;
  if (raw === 3 || raw === "3" || raw === "tier3" || raw === "critical" || raw === "danger") return 3;
  return 2;
}

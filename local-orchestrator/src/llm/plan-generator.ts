import type { LLMProvider, LLMResponse } from "./provider.js";
import type { LLMPlanOutput } from "../orchestrator/task-engine.js";
import type { StepTier } from "../orchestrator/plan.js";
import { DirtyJson } from "./dirty-json.js";
import type { RagContext } from "../rag/rag-retriever.js";
import { buildRagPromptSection } from "../rag/context-builder.js";

const PLAN_SYSTEM_PROMPT = `You are a task planner. Given a goal, output steps as a JSON array.

RULES:
1. Each step MUST reference the goal's specific details (not generic)
2. Tier 1 = read-only, Tier 2 = reversible write, Tier 3 = irreversible
3. Include "description", "tier", and "rationale" for each step

OUTPUT: ONLY the JSON array. Nothing else. No explanation, no preamble.

Example: [{"description":"Open Notepad from Start menu","tier":2,"rationale":"Opens an application on desktop"}]`;

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
      timeoutMs: config?.timeoutMs ?? 120_000,
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
    // Total attempts: maxRetries for parse failures + 1 extra for generic rejection retry
    const totalAttempts = this.config.maxRetries! + 1;

    for (let attempt = 0; attempt <= totalAttempts; attempt++) {
      try {
        const elapsed = Date.now() - startTime;
        const remaining = timeoutMs - elapsed;
        if (remaining <= 0) {
          console.warn(`[plan-generator] Timeout after ${elapsed}ms, returning default plan`);
          return this.defaultPlan(goal, "LLM request timed out");
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(new Error(`Timeout after ${remaining}ms`)), remaining);

        // On retry for generic plans, use a more explicit user prompt
        const userContent = attempt > this.config.maxRetries!
          ? `Goal: ${goal}\n\nREMINDER: You MUST reference specific technologies and details from the goal in every step. Generic steps like "Analyze the goal" or "Research" will be rejected. The goal text is: "${goal}"`
          : `Goal: ${goal}`;

        const response = await this.provider.chat(
          [
            { role: "system", content: systemContent },
            { role: "user", content: userContent },
          ],
          {
            temperature: attempt > this.config.maxRetries! ? 0.1 : 0.3,
            topP: 0.9,
            signal: controller.signal,
          },
        );

        clearTimeout(timer);

        const elapsed2 = Date.now() - startTime;
        console.log(`[plan-generator] LLM responded in ${elapsed2}ms (attempt ${attempt + 1})`);

        const steps = parsePlanOutput(response);
        if (steps.length === 0) {
          console.warn(`[plan-generator] No valid steps parsed from LLM output (attempt ${attempt + 1})`);
          lastError = new Error("No valid steps parsed from LLM output");
          continue;
        }

        // Validate plan quality: check for generic steps
        const validation = this.validatePlanQuality(steps, goal);
        if (!validation.valid) {
          console.warn(`[plan-generator] Plan failed quality check: ${validation.reason} (attempt ${attempt + 1})`);
          if (attempt < totalAttempts) {
            lastError = new Error(`Generic plan: ${validation.reason}`);
            continue;
          }
          // Last attempt — return what we have, even if generic
          console.warn(`[plan-generator] Returning plan despite quality issues (exhausted retries)`);
        }

        console.log(`[plan-generator] Parsed ${steps.length} steps from LLM output`);
        return steps;
      } catch (err) {
        const elapsed = Date.now() - startTime;
        const error = err instanceof Error ? err : new Error(String(err));
        console.error(`[plan-generator] LLM call failed (attempt ${attempt + 1}, ${elapsed}ms):`, error.message);
        lastError = error;

        // If timeout already exceeded total, don't retry
        if (elapsed >= timeoutMs) break;

        // Wait before retry
        if (attempt < totalAttempts) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
        }
      }
    }

    // All retries exhausted
    const reason = lastError?.message ?? "Unknown error";
    console.warn(`[plan-generator] All retries exhausted, returning default plan: ${reason}`);
    return this.defaultPlan(goal, reason);
  }

  private validatePlanQuality(steps: LLMPlanOutput[], goal: string): { valid: boolean; reason: string } {
    // Reject plans with fewer than 3 steps
    if (steps.length < 3) {
      return { valid: false, reason: `Only ${steps.length} step(s) — need at least 1` };
    }

    // Generic verb prefixes that indicate vague, low-quality steps
    const genericVerbs = [
      /^analyze\b/i,
      /^research\b/i,
      /^implement\b/i,
      /^review\b/i,
      /^test\b/i,
      /^verify\b/i,
      /^plan\b/i,
      /^set\s*up\b/i,
      /^configure\b/i,
      /^gather\b/i,
      /^identify\b/i,
      /^determine\b/i,
      /^assess\b/i,
      /^evaluate\b/i,
      /^consider\b/i,
      /^understand\b/i,
      /^explore\b/i,
      /^prepare\b/i,
    ];

    // Extract key terms from the goal (words > 3 chars, lowercased)
    const goalTerms = goal
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3);

    const genericSteps: string[] = [];
    const stepsWithoutGoalTerms: string[] = [];

    for (const step of steps) {
      const desc = step.description.toLowerCase();

      // Check for generic verb start
      const isGenericVerb = genericVerbs.some((re) => re.test(step.description.trim()));
      // Check if description contains meaningful goal-specific terms
      const hasGoalTerms = goalTerms.some((term) => desc.includes(term));

      if (isGenericVerb && !hasGoalTerms) {
        genericSteps.push(step.description);
      }
      if (!hasGoalTerms) {
        stepsWithoutGoalTerms.push(step.description);
      }
    }

    if (genericSteps.length > 0) {
      return {
        valid: false,
        reason: `${genericSteps.length} generic step(s): "${genericSteps[0]}" — must reference specific goal details`,
      };
    }

    if (stepsWithoutGoalTerms.length === steps.length) {
      return {
        valid: false,
        reason: "No steps reference specific terms from the goal",
      };
    }

    return { valid: true, reason: "" };
  }

  private defaultPlan(goal: string, reason: string): LLMPlanOutput[] {
    // Extract key terms from goal to make fallback more specific
    const keyTerms = goal
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 5)
      .join(", ");

    const displayGoal = keyTerms || goal.slice(0, 80);

    return [
      {
        description: `Examine existing files and resources related to: ${displayGoal}`,
        tier: 1 as StepTier,
        rationale: `Read-only exploration to understand current state (fallback: ${reason})`,
        connectorId: "filesystem",
      },
      {
        description: `Implement the core logic for: ${displayGoal}`,
        tier: 2 as StepTier,
        rationale: "Reversible implementation — creates/modifies files as needed",
        connectorId: "code",
      },
      {
        description: `Verify the implementation works correctly for: ${displayGoal}`,
        tier: 1 as StepTier,
        rationale: "Read-only validation of the output",
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

  // Pattern 1: Match "Step N: Description" followed by tier/rationale
  const stepBlockRegex = /(?:Step\s+\d+|^\s*\*?\*?Step\s+\d+)[\s\S]*?(?:Description|Action)[\s:]+([^\n]+)[\s\S]*?(?:Tier|Level)[\s:]+(\d)[\s\S]*?(?:Rationale|Reason)[\s:]+([^\n]+)/gim;
  let match: RegExpExecArray | null;
  while ((match = stepBlockRegex.exec(content)) !== null) {
    steps.push({
      description: match[1].trim(),
      tier: normalizeTier(match[2]),
      rationale: match[3].trim(),
    });
  }
  if (steps.length > 0) return steps;

  // Pattern 2: Match objects with description and tier fields
  const stepRegex = /\{[^{}]*"(?:description|step|action)"\s*:\s*"[^"]*"[^{}]*"(?:tier|level|priority)"\s*:\s*[123][^{}]*\}/gi;
  while ((match = stepRegex.exec(content)) !== null) {
    try {
      const parsed = DirtyJson.parseString(match[0]);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const steps1 = normalizeSteps([parsed]);
        if (steps1.length > 0) steps.push(steps1[0]);
      }
    } catch {}
  }

  // Pattern 3: Match "Description: X. Tier: Y. Rationale: Z."
  const descRegex = /Description:\s*([^\n.]+)[\.\n].*?Tier:\s*(\d).*?Rationale:\s*([^\n.]+)/gis;
  while ((match = descRegex.exec(content)) !== null) {
    steps.push({
      description: match[1].trim(),
      tier: normalizeTier(match[2]),
      rationale: match[3].trim(),
    });
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

import { describe, it, expect } from "vitest";
import { LLMPlanGeneratorImpl, parsePlanOutput } from "../../src/llm/plan-generator.js";
import type { LLMProvider, LLMResponse, ChatMessage, ChatOptions } from "../../src/llm/provider.js";
import type { LLMPlanOutput } from "../../src/orchestrator/task-engine.js";

// ─── Helpers ─────────────────────────────────────────────────

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

/** Extract key terms from a goal for validation */
function goalTerms(goal: string): string[] {
  return goal
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3);
}

/** Generic verb prefixes that should not appear at step start without goal context */
const GENERIC_VERBS = [
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

interface QualityCheck {
  passes: boolean;
  issues: string[];
}

function checkPlanQuality(steps: LLMPlanOutput[], goal: string): QualityCheck {
  const issues: string[] = [];
  const terms = goalTerms(goal);

  if (steps.length < 3) {
    issues.push(`Only ${steps.length} step(s) — need at least 3`);
  }

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const desc = step.description;
    const descLower = desc.toLowerCase();

    // Check for generic verb at start
    const isGenericVerb = GENERIC_VERBS.some((re) => re.test(desc.trim()));
    const hasGoalTerms = terms.some((t) => descLower.includes(t));

    if (isGenericVerb && !hasGoalTerms) {
      issues.push(`Step ${i + 1} is generic: "${desc}" — starts with generic verb without goal context`);
    }
    if (!hasGoalTerms) {
      issues.push(`Step ${i + 1} doesn't reference goal terms: "${desc}"`);
    }

    // Check tier is valid
    if (![1, 2, 3].includes(step.tier)) {
      issues.push(`Step ${i + 1} has invalid tier: ${step.tier}`);
    }

    // Check rationale exists
    if (!step.rationale || step.rationale.length < 10) {
      issues.push(`Step ${i + 1} has missing or too-short rationale`);
    }
  }

  return { passes: issues.length === 0, issues };
}

// ─── Goal A ──────────────────────────────────────────────────

const GOAL_A = "Write a Python script that reads a CSV file, calculates average revenue by region, and outputs a bar chart as PNG";

const GOOD_RESPONSE_A: LLMResponse = {
  content: JSON.stringify([
    {
      description: "Read the CSV file using pandas read_csv() to load the revenue dataset into a DataFrame for analysis",
      tier: 1,
      rationale: "Read-only file I/O — pandas read_csv only loads data without modifying the filesystem",
      connectorId: "filesystem",
    },
    {
      description: "Write Python code using pandas groupby('region').mean() to calculate average revenue per region from the CSV data",
      tier: 2,
      rationale: "Creates a new Python file with data transformation logic — reversible file write",
      connectorId: "code",
    },
    {
      description: "Write Python code using matplotlib.pyplot.bar() to generate a bar chart visualization of average revenue by region",
      tier: 2,
      rationale: "Extends the Python script with plotting code — reversible file modification",
      connectorId: "code",
    },
    {
      description: "Save the bar chart as PNG using matplotlib savefig('revenue_by_region.png') and verify the output file exists",
      tier: 2,
      rationale: "Produces a PNG output file — reversible file creation",
      connectorId: "filesystem",
    },
    {
      description: "Run the Python script with python script.py to verify it reads the CSV, computes averages, and outputs the bar chart correctly",
      tier: 2,
      rationale: "Executes the script to validate end-to-end functionality — reversible execution",
      connectorId: "code",
    },
  ]),
};

const GENERIC_RESPONSE_A: LLMResponse = {
  content: JSON.stringify([
    { description: "Analyze the goal and understand requirements", tier: 1, rationale: "Read-only analysis" },
    { description: "Research available Python libraries for CSV and charting", tier: 1, rationale: "Research phase" },
    { description: "Implement the Python script", tier: 2, rationale: "Reversible implementation" },
    { description: "Test the output", tier: 1, rationale: "Verification" },
  ]),
};

// ─── Goal B ──────────────────────────────────────────────────

const GOAL_B = "Research the top 5 most popular JavaScript frameworks in 2026 and create a comparison document with pros/cons for each";

const GOOD_RESPONSE_B: LLMResponse = {
  content: JSON.stringify([
    {
      description: "Search the web for 2026 JavaScript framework popularity rankings (State of JS survey, npm downloads, GitHub stars) to identify the top 5 frameworks",
      tier: 1,
      rationale: "Web research to gather current framework data — read-only browser operations",
      connectorId: "browser",
    },
    {
      description: "Create a Markdown file 'js-frameworks-comparison.md' with a header section listing the top 5 JavaScript frameworks (e.g., React, Vue, Svelte, Angular, Solid) with their 2026 version numbers",
      tier: 2,
      rationale: "Creates a new Markdown document — reversible file creation",
      connectorId: "filesystem",
    },
    {
      description: "For each of the 5 frameworks, write a pros/cons section covering: performance, bundle size, learning curve, ecosystem maturity, and TypeScript support",
      tier: 2,
      rationale: "Appends detailed comparison content to the Markdown file — reversible edit",
      connectorId: "filesystem",
    },
    {
      description: "Add a summary comparison table at the bottom of the document with columns: Framework, Stars, Bundle Size, Learning Curve, and Best For",
      tier: 2,
      rationale: "Adds structured data table to complete the comparison — reversible file edit",
      connectorId: "filesystem",
    },
    {
      description: "Review the final comparison document to ensure all 5 frameworks have accurate, balanced pros/cons and the data is consistent",
      tier: 1,
      rationale: "Read-only verification of document accuracy before presenting",
      connectorId: "filesystem",
    },
  ]),
};

const GENERIC_RESPONSE_B: LLMResponse = {
  content: JSON.stringify([
    { description: "Research the top JavaScript frameworks", tier: 1, rationale: "Research phase" },
    { description: "Create a comparison document", tier: 2, rationale: "File creation" },
    { description: "Review the output", tier: 1, rationale: "Verification" },
  ]),
};

// ─── Goal C ──────────────────────────────────────────────────

const GOAL_C = "Find all TODO comments in my codebase, group them by file, and create a prioritized task list in Markdown";

const GOOD_RESPONSE_C: LLMResponse = {
  content: JSON.stringify([
    {
      description: "Search the codebase using grep/ripgrep to find all TODO, FIXME, and HACK comments across all source files",
      tier: 1,
      rationale: "Read-only codebase search — grep only reads files without modification",
      connectorId: "filesystem",
    },
    {
      description: "Parse the grep output to extract each TODO comment with its file path, line number, and full comment text",
      tier: 1,
      rationale: "Read-only text parsing of search results — no file modifications",
      connectorId: "code",
    },
    {
      description: "Group the extracted TODOs by file path and sort groups by file directory structure",
      tier: 1,
      rationale: "Read-only data transformation — reorganizing parsed results in memory",
    },
    {
      description: "Create a Markdown file 'todo-priorities.md' with a prioritized task list, using priority labels (P0-P3) based on keywords like FIXME (high), TODO (medium), and HACK (low)",
      tier: 2,
      rationale: "Creates a new Markdown file with the organized task list — reversible file creation",
      connectorId: "filesystem",
    },
    {
      description: "Add a summary section at the top of todo-priorities.md showing total count, count by priority level, and count by directory",
      tier: 2,
      rationale: "Appends summary statistics to the Markdown document — reversible file edit",
      connectorId: "filesystem",
    },
  ]),
};

const GENERIC_RESPONSE_C: LLMResponse = {
  content: JSON.stringify([
    { description: "Analyze the codebase structure", tier: 1, rationale: "Read-only analysis" },
    { description: "Search for TODO comments", tier: 1, rationale: "Search phase" },
    { description: "Implement the grouping logic", tier: 2, rationale: "Code implementation" },
    { description: "Create the Markdown output", tier: 2, rationale: "File creation" },
    { description: "Verify the results", tier: 1, rationale: "Verification" },
  ]),
};

// ─── Tests ───────────────────────────────────────────────────

describe("plan quality — Goal A: Python CSV → bar chart", () => {
  it("good response passes all quality checks", async () => {
    const provider = makeProvider([GOOD_RESPONSE_A]);
    const gen = new LLMPlanGeneratorImpl(provider);
    const steps = await gen.generatePlan(GOAL_A);

    const check = checkPlanQuality(steps, GOAL_A);
    expect(check.passes).toBe(true);
    if (!check.passes) console.error("Goal A issues:", check.issues);

    // Verify specific technologies mentioned
    const allDesc = steps.map((s) => s.description.toLowerCase()).join(" ");
    expect(allDesc).toContain("python");
    expect(allDesc).toContain("csv");
    expect(allDesc).toContain("pandas");
    expect(allDesc).toContain("bar chart");
    expect(allDesc).toContain("png");

    // Verify tier correctness
    expect(steps[0].tier).toBe(1); // reading CSV = read-only
    expect(steps.some((s) => s.tier === 2)).toBe(true); // writing code = reversible

    // Verify connector suggestions
    expect(steps.some((s) => s.connectorId === "filesystem")).toBe(true);
    expect(steps.some((s) => s.connectorId === "code")).toBe(true);
  });

  it("generic response fails quality check", async () => {
    const provider = makeProvider([GENERIC_RESPONSE_A]);
    const gen = new LLMPlanGeneratorImpl(provider);
    const steps = await gen.generatePlan(GOAL_A);

    const check = checkPlanQuality(steps, GOAL_A);
    expect(check.passes).toBe(false);
    expect(check.issues.length).toBeGreaterThan(0);
    expect(check.issues.some((i) => i.includes("generic"))).toBe(true);
  });

  it("validation triggers retry and eventually returns plan", async () => {
    // Generic first, then good on retry
    const provider = makeProvider([GENERIC_RESPONSE_A, GOOD_RESPONSE_A]);
    const gen = new LLMPlanGeneratorImpl(provider, { maxRetries: 3 });
    const steps = await gen.generatePlan(GOAL_A);

    // Should get the good plan after retry
    const check = checkPlanQuality(steps, GOAL_A);
    expect(check.passes).toBe(true);
  });
});

describe("plan quality — Goal B: JS framework comparison", () => {
  it("good response passes all quality checks", async () => {
    const provider = makeProvider([GOOD_RESPONSE_B]);
    const gen = new LLMPlanGeneratorImpl(provider);
    const steps = await gen.generatePlan(GOAL_B);

    const check = checkPlanQuality(steps, GOAL_B);
    expect(check.passes).toBe(true);
    if (!check.passes) console.error("Goal B issues:", check.issues);

    // Verify specific technologies mentioned
    const allDesc = steps.map((s) => s.description.toLowerCase()).join(" ");
    expect(allDesc).toContain("javascript");
    expect(allDesc).toContain("framework");
    expect(allDesc).toContain("markdown");
    expect(allDesc).toContain("pros");
    expect(allDesc).toContain("cons");

    // Verify tier correctness
    expect(steps[0].tier).toBe(1); // web research = read-only
    expect(steps.some((s) => s.tier === 2)).toBe(true); // creating files = reversible
  });

  it("generic response fails quality check", async () => {
    const provider = makeProvider([GENERIC_RESPONSE_B]);
    const gen = new LLMPlanGeneratorImpl(provider);
    const steps = await gen.generatePlan(GOAL_B);

    const check = checkPlanQuality(steps, GOAL_B);
    expect(check.passes).toBe(false);
  });

  it("has correct step order: research before writing", async () => {
    const provider = makeProvider([GOOD_RESPONSE_B]);
    const gen = new LLMPlanGeneratorImpl(provider);
    const steps = await gen.generatePlan(GOAL_B);

    // First step should be research (tier 1), writing comes after
    expect(steps[0].tier).toBe(1);
    const firstWriteIdx = steps.findIndex((s) => s.tier === 2);
    expect(firstWriteIdx).toBeGreaterThan(0);
  });
});

describe("plan quality — Goal C: TODO task list", () => {
  it("good response passes all quality checks", async () => {
    const provider = makeProvider([GOOD_RESPONSE_C]);
    const gen = new LLMPlanGeneratorImpl(provider);
    const steps = await gen.generatePlan(GOAL_C);

    const check = checkPlanQuality(steps, GOAL_C);
    expect(check.passes).toBe(true);
    if (!check.passes) console.error("Goal C issues:", check.issues);

    // Verify specific technologies mentioned
    const allDesc = steps.map((s) => s.description.toLowerCase()).join(" ");
    expect(allDesc).toContain("todo");
    expect(allDesc).toContain("codebase");
    expect(allDesc).toContain("markdown");
    expect(allDesc).toContain("group");
    expect(allDesc).toContain("priorit");

    // Tier correctness: grep/search = tier 1, file creation = tier 2
    expect(steps[0].tier).toBe(1); // grep/search
    expect(steps.some((s) => s.tier === 2)).toBe(true); // file write
  });

  it("generic response fails quality check", async () => {
    const provider = makeProvider([GENERIC_RESPONSE_C]);
    const gen = new LLMPlanGeneratorImpl(provider);
    const steps = await gen.generatePlan(GOAL_C);

    const check = checkPlanQuality(steps, GOAL_C);
    expect(check.passes).toBe(false);
  });

  it("search step is tier 1, file creation is tier 2", async () => {
    const provider = makeProvider([GOOD_RESPONSE_C]);
    const gen = new LLMPlanGeneratorImpl(provider);
    const steps = await gen.generatePlan(GOAL_C);

    // grep/search steps should be tier 1
    const searchSteps = steps.filter(
      (s) => s.description.toLowerCase().includes("grep") || s.description.toLowerCase().includes("search"),
    );
    expect(searchSteps.length).toBeGreaterThan(0);
    expect(searchSteps.every((s) => s.tier === 1)).toBe(true);

    // file creation steps should be tier 2
    const writeSteps = steps.filter(
      (s) => s.description.toLowerCase().includes("create") || s.description.toLowerCase().includes("write"),
    );
    expect(writeSteps.length).toBeGreaterThan(0);
    expect(writeSteps.every((s) => s.tier === 2)).toBe(true);
  });
});

describe("plan quality — parsePlanOutput", () => {
  it("parses valid JSON array", () => {
    const response = {
      content: JSON.stringify([
        { description: "Step 1", tier: 1 },
        { description: "Step 2", tier: 2 },
      ]),
    };
    const steps = parsePlanOutput(response);
    expect(steps).toHaveLength(2);
    expect(steps[0].tier).toBe(1);
    expect(steps[1].tier).toBe(2);
  });

  it("handles markdown-wrapped JSON", () => {
    const response = {
      content: '```json\n[{"description": "Step 1", "tier": 1}]\n```',
    };
    const steps = parsePlanOutput(response);
    expect(steps).toHaveLength(1);
  });

  it("returns empty for garbage", () => {
    const response = { content: "not json at all, just text" };
    const steps = parsePlanOutput(response);
    expect(steps).toHaveLength(0);
  });
});

describe("plan quality — default plan fallback", () => {
  it("default plan references goal terms", async () => {
    const provider: LLMProvider = {
      async chat(): Promise<LLMResponse> {
        throw new Error("LLM unavailable");
      },
      async isAvailable(): Promise<boolean> {
        return false;
      },
    };
    const gen = new LLMPlanGeneratorImpl(provider);
    const steps = await gen.generatePlan("Write a Python web scraper for product prices");

    expect(steps.length).toBeGreaterThanOrEqual(3);
    const allDesc = steps.map((s) => s.description.toLowerCase()).join(" ");
    expect(allDesc).toContain("python");
    expect(allDesc).toContain("scraper");
    expect(allDesc).toContain("product");
  });
});

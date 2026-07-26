import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { vi } from "vitest";
import type { LLMProvider, LLMResponse, ChatMessage, ChatOptions } from "../src/llm/provider.js";
import type { LLMPlanOutput } from "../src/orchestrator/task-engine.js";
import type { StepTier } from "../src/orchestrator/plan.js";

// ─── Mock LLM Provider ──────────────────────────────────────

export interface MockLLMConfig {
  responses?: LLMResponse[];
  planSteps?: LLMPlanOutput[];
  failAfter?: number;
  delayMs?: number;
}

export function createMockLLMProvider(config: MockLLMConfig = {}): LLMProvider {
  let callCount = 0;
  const responses = config.responses ?? [];

  return {
    async chat(_messages: ChatMessage[], _options?: ChatOptions): Promise<LLMResponse> {
      if (config.delayMs) {
        await new Promise((r) => setTimeout(r, config.delayMs));
      }
      if (config.failAfter !== undefined && callCount >= config.failAfter) {
        throw new Error("LLM provider unavailable");
      }
      callCount++;
      if (responses.length > 0) {
        return responses[callCount - 1] ?? responses[responses.length - 1];
      }
      return { content: "[]" };
    },
    async isAvailable(): Promise<boolean> {
      if (config.failAfter !== undefined && callCount >= config.failAfter) {
        return false;
      }
      return true;
    },
  };
}

export function createMockPlanGenerator(planSteps?: LLMPlanOutput[]) {
  const steps: LLMPlanOutput[] = planSteps ?? [
    { description: "Analyze the codebase", tier: 1 as StepTier, rationale: "Read-only analysis" },
    { description: "Create the new module", tier: 2 as StepTier, rationale: "Reversible file creation" },
    { description: "Update production config", tier: 3 as StepTier, rationale: "Critical change" },
  ];

  return {
    async generatePlan(_goal: string): Promise<LLMPlanOutput[]> {
      return steps;
    },
  };
}

// ─── Mock Connector ─────────────────────────────────────────

export function createMockConnector() {
  const files = new Map<string, string>();

  return {
    files,
    async readFile(path: string): Promise<string> {
      const content = files.get(path);
      if (content === undefined) throw new Error(`File not found: ${path}`);
      return content;
    },
    async writeFile(path: string, content: string): Promise<void> {
      files.set(path, content);
    },
    async deleteFile(path: string): Promise<void> {
      if (!files.has(path)) throw new Error(`File not found: ${path}`);
      files.delete(path);
    },
  };
}

// ─── Test Fixtures ──────────────────────────────────────────

export const FIXTURES = {
  goals: {
    simple: "Create a README file",
    complex: "Build a REST API with authentication and database",
    multiStep: "Analyze the codebase, create a new module, and update configs",
  },

  planSteps: {
    tier1Only: [
      { description: "Read project files", tier: 1 as StepTier, rationale: "Analysis" },
    ],
    mixed: [
      { description: "Analyze goal and gather context", tier: 1 as StepTier, rationale: "Read-only analysis" },
      { description: "Create draft document", tier: 2 as StepTier, rationale: "Reversible write" },
      { description: "Deploy to production", tier: 3 as StepTier, rationale: "Critical change" },
    ],
    demo: [
      { description: "Research existing project files", tier: 1 as StepTier, rationale: "Read-only research", connectorId: "filesystem" },
      { description: "Write project summary draft", tier: 2 as StepTier, rationale: "Reversible document creation", connectorId: "filesystem" },
      { description: "Review and refine the draft", tier: 2 as StepTier, rationale: "Edit with undo capability", connectorId: "filesystem" },
      { description: "Present final summary to user", tier: 1 as StepTier, rationale: "Read-only output" },
    ],
  },

  llmResponses: {
    validJson: { content: JSON.stringify([
      { description: "Read the codebase", tier: 1, rationale: "Analysis" },
      { description: "Create new file", tier: 2, rationale: "Write" },
    ]) },
    withComments: { content: `// Plan steps\n[\n  {"description": "Step 1", "tier": 1},\n  {"description": "Step 2", "tier": 2}\n]` },
    withTrailingComma: { content: '[{"description": "Step 1", "tier": 1,},]' },
    markdownWrapped: { content: 'Here is the plan:\n```json\n[{"description": "Step 1", "tier": 1}]\n```\nDone.' },
    textWrapped: { content: 'I will create a plan:\n[{"description": "Analyze", "tier": 1}]\nThat is all.' },
  },
};

// ─── Temp Directory Helpers ──────────────────────────────────

export interface TestProject {
  dir: string;
  cleanup: () => Promise<void>;
}

export async function createTestProject(name?: string): Promise<TestProject> {
  const dir = await mkdtemp(join(tmpdir(), `gemork-test-${name ?? "default"}-`));

  return {
    dir,
    async cleanup() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export async function createTestFile(project: TestProject, relativePath: string, content: string): Promise<string> {
  const fullPath = join(project.dir, relativePath);
  const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
  await mkdir(dir, { recursive: true });
  await writeFile(fullPath, content, "utf-8");
  return fullPath;
}

export async function readTestFile(path: string): Promise<string> {
  return readFile(path, "utf-8");
}

// ─── Event Collector ─────────────────────────────────────────

export class EventCollector {
  private events: Array<{ type: string; data: unknown }> = [];

  collect(type: string): void {
    this.events.push({ type, data: undefined });
  }

  capture<T>(type: string): (event: T) => void {
    return (event: T) => {
      this.events.push({ type, data: event });
    };
  }

  getEvents(type?: string): Array<{ type: string; data: unknown }> {
    if (type) return this.events.filter((e) => e.type === type);
    return [...this.events];
  }

  getEventCount(type?: string): number {
    return this.getEvents(type).length;
  }

  clear(): void {
    this.events = [];
  }
}

// ─── Cleanup Helper ──────────────────────────────────────────

export async function cleanupTestArtifacts(projectDir: string): Promise<void> {
  try {
    await rm(join(projectDir, ".gemork"), { recursive: true, force: true });
  } catch {
    // Ignore if doesn't exist
  }
}

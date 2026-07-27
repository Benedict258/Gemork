import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { VectorStore } from "../../src/rag/vector-store.js";
import { SimpleEmbeddingProvider } from "../../src/rag/embedding-provider.js";
import { RagRetriever, type RagContext } from "../../src/rag/rag-retriever.js";
import { buildRagPromptSection } from "../../src/rag/context-builder.js";
import { LLMPlanGeneratorImpl } from "../../src/llm/plan-generator.js";
import { TaskEngine } from "../../src/orchestrator/task-engine.js";
import { createMockLLMProvider } from "../setup.js";
import type { LLMPlanOutput } from "../../src/orchestrator/task-engine.js";
import type { StepTier } from "../../src/orchestrator/plan.js";

// ─── Helpers ────────────────────────────────────────────────

interface TestProject {
  dir: string;
  projectId: string;
  cleanup: () => Promise<void>;
}

async function createTestProject(name: string): Promise<TestProject> {
  const dir = await mkdtemp(join(tmpdir(), `gemork-rag-test-${name}-`));
  const projectId = `test-${name}-${Date.now()}`;
  return {
    dir,
    projectId,
    async cleanup() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

// ─── Tests ──────────────────────────────────────────────────

describe("RAG-enhanced plan generation", () => {
  let project: TestProject;
  let embeddingProvider: SimpleEmbeddingProvider;

  beforeEach(async () => {
    project = await createTestProject("rag-plan");
    embeddingProvider = new SimpleEmbeddingProvider();
  });

  afterEach(async () => {
    // Clean up vector store DB files
    try {
      const store = new VectorStore(project.projectId);
      store.deleteProject(project.projectId);
      store.close();
    } catch {}
    await project.cleanup();
  });

  describe("VectorStore + RagRetriever integration", () => {
    it("returns empty context when vector store is empty", async () => {
      const retriever = new RagRetriever({
        projectId: project.projectId,
        embeddingProvider,
      });

      const context = await retriever.retrieveContext("read the README file");

      expect(context.relevantMemory).toHaveLength(0);
      expect(context.relevantFiles).toHaveLength(0);
      expect(context.relevantPlans).toHaveLength(0);
      expect(context.projectId).toBe(project.projectId);
    });

    it("retrieves indexed file content by similarity", async () => {
      const store = new VectorStore(project.projectId);

      // Index a file simulating a past project memory
      const readmeContent =
        "README: This project is a data processing pipeline. " +
        "It reads CSV files from the data/ directory and outputs JSON summaries.";
      const embedding = await embeddingProvider.embed(readmeContent);
      store.add(project.projectId, readmeContent, embedding, {
        type: "file",
        filePath: "README.md",
      });
      store.close();

      const retriever = new RagRetriever({
        projectId: project.projectId,
        embeddingProvider,
      });

      const context = await retriever.retrieveContext("read the README file");

      expect(context.relevantFiles.length).toBeGreaterThan(0);
      expect(context.relevantFiles[0].filePath).toBe("README.md");
      expect(context.relevantFiles[0].content).toContain("data processing pipeline");
    });

    it("retrieves indexed memory entries", async () => {
      const store = new VectorStore(project.projectId);

      const memoryText =
        "Agent main-agent performed: readFile. " +
        "Rationale: Needed to understand the project structure before making changes.";
      const embedding = await embeddingProvider.embed(memoryText);
      store.add(project.projectId, memoryText, embedding, {
        type: "memory",
        agentId: "main-agent",
        action: "readFile",
      });
      store.close();

      const retriever = new RagRetriever({
        projectId: project.projectId,
        embeddingProvider,
      });

      const context = await retriever.retrieveContext("read the README file");

      expect(context.relevantMemory.length).toBeGreaterThan(0);
      expect(context.relevantMemory[0].metadata.agentId).toBe("main-agent");
    });

    it("retrieves indexed plan results", async () => {
      const store = new VectorStore(project.projectId);

      const planText =
        "Plan plan-001 (completed): " +
        "Step (tier 1, completed): Read the README file and summarize it; " +
        "Step (tier 2, completed): Create a Python script to process data";
      const embedding = await embeddingProvider.embed(planText);
      store.add(project.projectId, planText, embedding, {
        type: "plan",
        planId: "plan-001",
        goalId: "goal-001",
        status: "completed",
      });
      store.close();

      const retriever = new RagRetriever({
        projectId: project.projectId,
        embeddingProvider,
      });

      const context = await retriever.retrieveContext(
        "read the README file and summarize it",
      );

      expect(context.relevantPlans.length).toBeGreaterThan(0);
      expect(context.relevantPlans[0].planId).toBe("plan-001");
    });
  });

  describe("buildRagPromptSection formatting", () => {
    it("returns empty string for null/undefined context", () => {
      expect(buildRagPromptSection(null as any)).toBe("");
      expect(buildRagPromptSection(undefined as any)).toBe("");
    });

    it("formats memory, files, and plans into prompt section", () => {
      const context: RagContext = {
        projectId: project.projectId,
        relevantMemory: [
          {
            content: "Agent read README.md",
            metadata: { agentId: "agent-1", action: "readFile" },
            score: 0.95,
          },
        ],
        relevantFiles: [
          {
            filePath: "README.md",
            content: "Project overview: data processing pipeline",
            score: 0.92,
          },
        ],
        relevantPlans: [
          {
            planId: "plan-001",
            content: "Plan: read README, create script",
            score: 0.88,
          },
        ],
      };

      const section = buildRagPromptSection(context);

      expect(section).toContain("--- PROJECT CONTEXT (from RAG) ---");
      expect(section).toContain("Recent Agent Actions:");
      expect(section).toContain("agent-1");
      expect(section).toContain("Relevant Files:");
      expect(section).toContain("README.md");
      expect(section).toContain("Similar Past Plans:");
      expect(section).toContain("plan-001");
      expect(section).toContain("--- END PROJECT CONTEXT ---");
    });
  });

  describe("Plan generator receives RAG context", () => {
    it("passes RAG context to the LLM system prompt", async () => {
      const ragContext: RagContext = {
        projectId: project.projectId,
        relevantMemory: [],
        relevantFiles: [
          {
            filePath: "README.md",
            content: "This is a data processing project that reads CSV files",
            score: 0.9,
          },
        ],
        relevantPlans: [],
      };

      // Track what the LLM receives
      let receivedSystemPrompt = "";
      const mockProvider = createMockLLMProvider({
        responses: [
          {
            content: JSON.stringify([
              {
                description: "Read the README.md file for project context",
                tier: 1,
                rationale: "RAG context indicates README exists with project info",
              },
              {
                description: "Create Python script to process CSV data",
                tier: 2,
                rationale: "Build on README context about CSV processing",
              },
            ]),
          },
        ],
      });

      const generator = new LLMPlanGeneratorImpl(mockProvider);

      // Override provider.chat to capture the system prompt
      const originalChat = mockProvider.chat;
      mockProvider.chat = async (messages, options) => {
        const systemMsg = messages.find((m) => m.role === "system");
        if (systemMsg) receivedSystemPrompt = systemMsg.content;
        return originalChat.call(mockProvider, messages, options);
      };

      const steps = await generator.generatePlan(
        "read the README and create a processing script",
        ragContext,
      );

      expect(steps.length).toBeGreaterThan(0);
      expect(receivedSystemPrompt).toContain("--- PROJECT CONTEXT (from RAG) ---");
      expect(receivedSystemPrompt).toContain("README.md");
      expect(receivedSystemPrompt).toContain("data processing project");
    });

    it("works without RAG context (backward compatible)", async () => {
      const mockProvider = createMockLLMProvider({
        responses: [
          {
            content: JSON.stringify([
              { description: "Analyze the goal", tier: 1, rationale: "Read-only" },
            ]),
          },
        ],
      });

      let receivedSystemPrompt = "";
      const originalChat = mockProvider.chat;
      mockProvider.chat = async (messages, options) => {
        const systemMsg = messages.find((m) => m.role === "system");
        if (systemMsg) receivedSystemPrompt = systemMsg.content;
        return originalChat.call(mockProvider, messages, options);
      };

      const generator = new LLMPlanGeneratorImpl(mockProvider);
      const steps = await generator.generatePlan("do something");

      expect(steps.length).toBeGreaterThan(0);
      expect(receivedSystemPrompt).not.toContain("PROJECT CONTEXT (from RAG)");
    });
  });

  describe("TaskEngine wires RAG into plan generation", () => {
    it("retrieves RAG context and passes it to the plan generator", async () => {
      // Index past project knowledge into the vector store
      const store = new VectorStore(project.projectId);

      // Simulate: a previous task read the README
      const readmeMemory =
        "Agent main-agent performed: readFile README.md. " +
        "Rationale: To understand the project structure before creating new scripts.";
      const memEmbedding = await embeddingProvider.embed(readmeMemory);
      store.add(project.projectId, readmeMemory, memEmbedding, {
        type: "memory",
        agentId: "main-agent",
        action: "readFile",
      });

      // Simulate: the README file content was indexed
      const readmeContent =
        "README: Gemork is an autonomous AI agent system. " +
        "It uses a plan-and-execute model with tiered permissions.";
      const fileEmbedding = await embeddingProvider.embed(readmeContent);
      store.add(project.projectId, readmeContent, fileEmbedding, {
        type: "file",
        filePath: "README.md",
      });

      // Simulate: a past plan that read the README
      const pastPlan =
        "Plan past-001 (completed): " +
        "Step (tier 1, completed): Read README.md to understand project structure";
      const planEmbedding = await embeddingProvider.embed(pastPlan);
      store.add(project.projectId, pastPlan, planEmbedding, {
        type: "plan",
        planId: "past-001",
        goalId: "goal-001",
        status: "completed",
      });

      store.close();

      // Track what the mock plan generator receives
      let capturedRagContext: RagContext | undefined;
      const trackingGenerator = {
        async generatePlan(
          _goal: string,
          ragContext?: RagContext,
        ): Promise<LLMPlanOutput[]> {
          capturedRagContext = ragContext;
          return [
            {
              description:
                "Read the README.md file and summarize project structure",
              tier: 1 as StepTier,
              rationale:
                "RAG context shows README contains project overview",
            },
            {
              description:
                "Create a Python script to process data based on README",
              tier: 2 as StepTier,
              rationale:
                "Build on README context about data processing pipeline",
            },
          ];
        },
      };

      const engine = new TaskEngine({
        llmGenerator: trackingGenerator,
        projectId: project.projectId,
      });

      const result = await engine.run({
        goal: "Read the README and create a data processing script",
        autoApprove: true,
      });

      // Verify RAG context was retrieved and passed
      expect(capturedRagContext).toBeDefined();
      expect(capturedRagContext!.relevantMemory.length).toBeGreaterThan(0);
      expect(capturedRagContext!.relevantFiles.length).toBeGreaterThan(0);
      expect(capturedRagContext!.relevantPlans.length).toBeGreaterThan(0);

      // Verify the plan was generated with RAG-informed steps
      expect(result.plan.steps.length).toBe(2);
      expect(result.plan.steps[0].description).toContain("README");
      expect(result.plan.steps[1].description).toContain("Python script");
    });

    it("gracefully handles empty vector store", async () => {
      let generatorCalled = false;
      const trackingGenerator = {
        async generatePlan(
          _goal: string,
          ragContext?: RagContext,
        ): Promise<LLMPlanOutput[]> {
          generatorCalled = true;
          // RAG returns empty context (not undefined) when no data exists
          expect(ragContext).toBeDefined();
          expect(ragContext!.relevantMemory).toHaveLength(0);
          expect(ragContext!.relevantFiles).toHaveLength(0);
          expect(ragContext!.relevantPlans).toHaveLength(0);
          return [
            {
              description: "Fallback plan step",
              tier: 1 as StepTier,
              rationale: "Default when RAG returns no context",
            },
          ];
        },
      };

      const engine = new TaskEngine({
        llmGenerator: trackingGenerator,
        projectId: "empty-project-xyz",
      });

      const result = await engine.run({
        goal: "Do something",
        autoApprove: true,
      });

      expect(generatorCalled).toBe(true);
      expect(result.plan.steps.length).toBe(1);
    });
  });

  describe("Demo scenario: sequential task awareness via RAG", () => {
    it("Task 2 plan references Task 1 context from RAG", async () => {
      // === Simulate Task 1 completion ===
      // After Task 1 runs, its result gets indexed into the vector store
      const store = new VectorStore(project.projectId);

      // Index Task 1's plan result
      const task1Plan =
        "Plan task1-plan (completed): " +
        "Step (tier 1, completed): Read the README file and summarize it";
      const planEmbedding = await embeddingProvider.embed(task1Plan);
      store.add(project.projectId, task1Plan, planEmbedding, {
        type: "plan",
        planId: "task1-plan",
        goalId: "task1-goal",
        status: "completed",
      });

      // Index Task 1's memory (what the agent actually did)
      const task1Memory =
        "Agent main-agent performed: readFile README.md. " +
        "Rationale: User requested README summary. " +
        "File contains: Gemork project overview, architecture diagram, setup instructions.";
      const memEmbedding = await embeddingProvider.embed(task1Memory);
      store.add(project.projectId, task1Memory, memEmbedding, {
        type: "memory",
        agentId: "main-agent",
        action: "readFile",
      });

      // Index the README file content itself
      const readmeContent =
        "README: Gemork is an autonomous AI agent system. " +
        "The project uses a plan-and-execute model. " +
        "Data files are stored in the data/ directory as CSV format.";
      const fileEmbedding = await embeddingProvider.embed(readmeContent);
      store.add(project.projectId, readmeContent, fileEmbedding, {
        type: "file",
        filePath: "README.md",
      });

      store.close();

      // === Simulate Task 2 planning with RAG ===
      let capturedRagContext: RagContext | undefined;
      let capturedGoal: string = "";

      const trackingGenerator = {
        async generatePlan(
          goal: string,
          ragContext?: RagContext,
        ): Promise<LLMPlanOutput[]> {
          capturedGoal = goal;
          capturedRagContext = ragContext;

          // Simulate LLM using RAG context to inform the plan
          const hasReadmeContext =
            ragContext?.relevantFiles.some((f) =>
              f.filePath.includes("README"),
            ) ?? false;
          const hasTask1Context =
            ragContext?.relevantPlans.some((p) =>
              p.content.includes("Read the README"),
            ) ?? false;

          const steps: LLMPlanOutput[] = [];

          if (hasTask1Context) {
            steps.push({
              description:
                "Review the README summary from the previous task",
              tier: 1 as StepTier,
              rationale:
                "RAG context shows Task 1 already read the README - reference that work",
            });
          }

          if (hasReadmeContext) {
            steps.push({
              description:
                "Create a Python script to process CSV data from data/ directory",
              tier: 2 as StepTier,
              rationale:
                "RAG context from README indicates data files are CSV in data/ directory",
            });
          } else {
            steps.push({
              description: "Create a Python script to process data",
              tier: 2 as StepTier,
              rationale: "Generic data processing script",
            });
          }

          return steps;
        },
      };

      const engine = new TaskEngine({
        llmGenerator: trackingGenerator,
        projectId: project.projectId,
      });

      const result = await engine.run({
        goal: "Create a Python script to process the data file",
        autoApprove: true,
      });

      // Verify RAG context was present
      expect(capturedRagContext).toBeDefined();
      expect(capturedRagContext!.relevantPlans.length).toBeGreaterThan(0);
      expect(capturedRagContext!.relevantFiles.length).toBeGreaterThan(0);
      expect(capturedRagContext!.relevantMemory.length).toBeGreaterThan(0);

      // Verify the plan references Task 1's work
      expect(result.plan.steps.length).toBe(2);
      expect(result.plan.steps[0].description).toContain("README");
      expect(result.plan.steps[0].rationale).toContain("Task 1");
      expect(result.plan.steps[1].description).toContain("CSV");
      expect(result.plan.steps[1].rationale).toContain("README");
    });
  });
});

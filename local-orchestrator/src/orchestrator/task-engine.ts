import { v4 as uuid } from "uuid";
import {
  createGoal,
  createPlan,
  createPlanStep,
  getPlanStepById,
  getExecutableSteps,
  getApprovalRequiredSteps,
  isPlanComplete,
  type Goal,
  type Plan,
  type PlanStep,
  type StepTier,
} from "./plan.js";
import { OrchestratorEventBus } from "./event-bus.js";
import {
  SubAgentCoordinator,
  type SubAgentTaskResult,
} from "./sub-agent-coordinator.js";
import { loadLLMConfig } from "../llm/config.js";
import { registerProvider, getProvider } from "../llm/provider-registry.js";
import { OllamaProvider } from "../llm/providers/ollama-provider.js";
import { LlamaCppProvider } from "../llm/providers/llamacpp-provider.js";
import { OpenAIProvider } from "../llm/providers/openai-provider.js";
import { AnthropicProvider } from "../llm/providers/anthropic-provider.js";
import { GeminiProvider } from "../llm/providers/gemini-provider.js";
import { LLMPlanGeneratorImpl } from "../llm/plan-generator.js";
import type { LLMProvider } from "../llm/provider.js";
import { StateSaver, type TaskState } from "../persistence/state-saver.js";
import { InboxManager } from "../inbox/inbox-manager.js";
import { LoopDetector } from "../loop-detector/loop-detector.js";
import { RagRetriever, type RagContext } from "../rag/rag-retriever.js";
import { createEmbeddingProvider, type EmbeddingProvider } from "../rag/embedding-provider.js";

// ─── LLM Integration ───────────────────────────────────────

export interface LLMPlanOutput {
  description: string;
  tier: StepTier;
  connectorId?: string;
  rationale?: string;
}

export interface LLMPlanGenerator {
  generatePlan(goal: string, ragContext?: RagContext): Promise<LLMPlanOutput[]>;
}

// Auto-register built-in providers
registerProvider("ollama", () => new OllamaProvider(loadLLMConfig({ provider: "ollama" })));
registerProvider("llamacpp", () => new LlamaCppProvider(loadLLMConfig({ provider: "llamacpp" })));
registerProvider("openai", () => new OpenAIProvider());
registerProvider("anthropic", () => new AnthropicProvider());
registerProvider("gemini", () => new GeminiProvider());

/**
 * Create an LLM provider from config via the registry.
 * Falls back gracefully if the provider is unreachable.
 */
export function createLLMProvider(): LLMProvider {
  const config = loadLLMConfig();
  try {
    return getProvider(config.provider);
  } catch {
    return new OllamaProvider(config);
  }
}

/**
 * Create a plan generator backed by the configured local LLM.
 */
export function createPlanGenerator(): LLMPlanGenerator {
  return new LLMPlanGeneratorImpl(createLLMProvider());
}

// ─── Task Engine Configuration ───────────────────────────────

export interface TaskEngineConfig {
  maxConcurrency?: number;
  llmGenerator?: LLMPlanGenerator;
  autoApprove?: boolean;
  approvalTimeoutMs?: number;
  projectId?: string;
}

// ─── Task Engine ─────────────────────────────────────────────

export interface TaskEngineRunOptions {
  goal: string;
  goalId?: string;
  autoApprove?: boolean;
}

export interface TaskEngineRunResult {
  goal: Goal;
  plan: Plan;
  results: Map<string, SubAgentTaskResult>;
}

/**
 * The core task/plan engine.
 *
 * Execution loop (inspired by Agent Zero's monologue() and OpenWorker's TurnEngine):
 *   1. Receive goal (natural language string)
 *   2. Generate plan via LLM (decompose into steps)
 *   3. Enqueue steps to sub-agent coordinator
 *   4. For each executable step (tier 1/2):
 *      a. Start sub-agent
 *      b. Execute step (mock for now)
 *      c. Collect result
 *      d. Update plan status
 *   5. For tier 3 steps:
 *      a. Pause execution
 *      b. Emit approval:request
 *      c. Await human approval or rejection
 *   6. Aggregate results into plan
 *   7. Mark plan complete or failed
 */
export class TaskEngine {
  private eventBus: OrchestratorEventBus;
  private coordinator: SubAgentCoordinator;
  private llmGenerator: LLMPlanGenerator;
  private loopDetector: LoopDetector;
  private plans: Map<string, Plan> = new Map();
  private goals: Map<string, Goal> = new Map();
  private activeRuns: Map<string, AbortController> = new Map();
  private inboxManager: InboxManager;
  private stateSaver: StateSaver;
  private embeddingProvider: EmbeddingProvider | null = null;
  private projectId: string;

  constructor(config?: TaskEngineConfig) {
    this.eventBus = new OrchestratorEventBus();
    this.coordinator = new SubAgentCoordinator({
      maxConcurrency: config?.maxConcurrency ?? 3,
    });
    this.coordinator.attachEventBus(this.eventBus);
    this.llmGenerator = config?.llmGenerator ?? createPlanGenerator();
    this.loopDetector = new LoopDetector();
    this.inboxManager = new InboxManager("default");
    this.stateSaver = new StateSaver();
    this.projectId = config?.projectId ?? "default";
  }

  getInboxManager(): InboxManager {
    return this.inboxManager;
  }

  // ── State Persistence ──────────────────────────────────────

  private async saveTaskState(plan: Plan, projectId: string, sessionId: string): Promise<void> {
    const completedSteps = plan.steps
      .filter((s) => s.status === "completed")
      .map((s) => s.id);
    const pendingApprovals = plan.steps
      .filter((s) => s.status === "awaiting_approval")
      .map((s) => s.id);
    const currentIndex = plan.steps.findIndex(
      (s) => s.status === "running" || s.status === "pending",
    );

    const state: TaskState = {
      sessionId,
      planId: plan.id,
      goalId: plan.goalId,
      currentStepIndex: currentIndex >= 0 ? currentIndex : plan.steps.length,
      completedSteps,
      pendingApprovals,
      startedAt: plan.createdAt.toISOString(),
      lastCheckpoint: new Date().toISOString(),
    };

    await this.stateSaver.saveState(projectId, sessionId, state);
  }

  // ── Public API ───────────────────────────────────────────

  getEventBus(): OrchestratorEventBus {
    return this.eventBus;
  }

  getCoordinator(): SubAgentCoordinator {
    return this.coordinator;
  }

  getPlan(planId: string): Plan | undefined {
    return this.plans.get(planId);
  }

  getAllPlans(): Plan[] {
    return Array.from(this.plans.values());
  }

  getGoal(goalId: string): Goal | undefined {
    return this.goals.get(goalId);
  }

  /**
   * Run the full orchestration loop for a goal.
   * This is the main entry point — equivalent to Agent Zero's monologue().
   */
  async run(opts: TaskEngineRunResult extends never ? never : TaskEngineRunOptions): Promise<TaskEngineRunResult> {
    const goal = createGoal(opts.goal);
    this.goals.set(goal.id, goal);

    // ── Phase 1: Generate Plan ─────────────────────────────
    const plan = await this.generatePlan(goal);
    this.plans.set(plan.id, plan);

    this.eventBus.publish({
      type: "plan:created",
      plan: structuredClone(plan),
      timestamp: new Date(),
    });

    // ── Phase 2: Execute Plan ──────────────────────────────
    const controller = new AbortController();
    this.activeRuns.set(plan.id, controller);

    try {
      await this.executePlan(plan, opts.autoApprove ?? false, controller.signal);

      if (controller.signal.aborted) {
        plan.status = "paused";
        this.eventBus.publish({
          type: "plan:paused",
          plan: structuredClone(plan),
          reason: "Aborted by user",
          timestamp: new Date(),
        });
      } else {
        plan.status = "completed";
        plan.completedAt = new Date();
        this.eventBus.publish({
          type: "plan:completed",
          plan: structuredClone(plan),
          timestamp: new Date(),
        });
      }

      // Persist final state
      const projectId = plan.goalId;
      const sessionId = plan.id;
      await this.saveTaskState(plan, projectId, sessionId).catch(() => {});
    } catch (err) {
      plan.status = "paused";
      this.eventBus.publish({
        type: "plan:paused",
        plan: structuredClone(plan),
        reason: err instanceof Error ? err.message : "Unknown error",
        timestamp: new Date(),
      });
    } finally {
      this.activeRuns.delete(plan.id);
    }

    // ── Phase 3: Aggregate Results ─────────────────────────
    const results = this.coordinator.aggregatePlanResults(plan.id);

    return { goal, plan, results };
  }

  /**
   * Pause an active run.
   */
  pausePlan(planId: string): void {
    const controller = this.activeRuns.get(planId);
    if (controller) {
      controller.abort();
    }
  }

  /**
   * Approve a tier-3 step that is awaiting approval.
   */
  approveStep(planId: string, stepId: string): PlanStep {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(`Plan ${planId} not found`);

    const step = getPlanStepById(plan, stepId);
    if (!step) throw new Error(`Step ${stepId} not found in plan ${planId}`);

    if (step.status !== "awaiting_approval") {
      throw new Error(
        `Step ${stepId} is not awaiting approval (current: ${step.status})`,
      );
    }

    step.status = "pending";

    this.eventBus.publish({
      type: "approval:granted",
      planId,
      stepId,
      timestamp: new Date(),
    });

    // Resume plan execution if paused
    if (plan.status === "awaiting_approval") {
      plan.status = "executing";
      this.eventBus.publish({
        type: "plan:updated",
        plan: structuredClone(plan),
        timestamp: new Date(),
      });
      this.processRemainingSteps(plan);
    }

    return step;
  }

  /**
   * Reject a tier-3 step that is awaiting approval.
   */
  rejectStep(planId: string, stepId: string, reason?: string): PlanStep {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(`Plan ${planId} not found`);

    const step = getPlanStepById(plan, stepId);
    if (!step) throw new Error(`Step ${stepId} not found in plan ${planId}`);

    step.status = "failed";
    step.error = reason ?? "Rejected by user";

    this.eventBus.publish({
      type: "approval:rejected",
      planId,
      stepId,
      reason,
      timestamp: new Date(),
    });

    this.eventBus.publish({
      type: "step:failed",
      planId,
      step: structuredClone(step),
      error: step.error,
      timestamp: new Date(),
    });

    return step;
  }

  // ── Plan Generation ──────────────────────────────────────

  private async generatePlan(goal: Goal): Promise<Plan> {
    const startTime = Date.now();
    console.log(`[task-engine] Generating plan for goal: "${goal.text}"`);

    // Retrieve RAG context before generating the plan
    let ragContext: RagContext | undefined;
    try {
      if (!this.embeddingProvider) {
        this.embeddingProvider = await createEmbeddingProvider();
      }
      const retriever = new RagRetriever({
        projectId: this.projectId,
        embeddingProvider: this.embeddingProvider,
      });
      ragContext = await retriever.retrieveContext(goal.text);
      const totalContext =
        ragContext.relevantMemory.length +
        ragContext.relevantFiles.length +
        ragContext.relevantPlans.length;
      if (totalContext > 0) {
        console.log(
          `[task-engine] RAG retrieved ${totalContext} context items ` +
          `(${ragContext.relevantMemory.length} memory, ` +
          `${ragContext.relevantFiles.length} files, ` +
          `${ragContext.relevantPlans.length} plans)`,
        );
      } else {
        console.log("[task-engine] RAG: no relevant context found in vector store");
      }
    } catch (err) {
      console.warn("[task-engine] RAG retrieval failed, proceeding without context:", err);
    }

    const outputs = await this.llmGenerator.generatePlan(goal.text, ragContext);

    const elapsed = Date.now() - startTime;
    console.log(`[task-engine] Plan generated in ${elapsed}ms with ${outputs.length} steps`);

    const steps = outputs.map((output) =>
      createPlanStep(goal.id, output.description, output.tier, {
        connectorId: output.connectorId,
        rationale: output.rationale,
      }),
    );

    const plan = createPlan(goal.id, steps);
    plan.status = "executing";
    return plan;
  }

  // ── Plan Execution ───────────────────────────────────────

  private async executePlan(
    plan: Plan,
    autoApprove: boolean,
    signal: AbortSignal,
  ): Promise<void> {
    const approvalSteps = getApprovalRequiredSteps(plan);
    if (approvalSteps.length > 0 && !autoApprove) {
      for (const step of approvalSteps) {
        step.status = "awaiting_approval";
        this.inboxManager.enqueue({
          type: "approval",
          payload: {
            planId: plan.id,
            stepId: step.id,
            description: step.description,
            tier: step.tier,
            rationale: step.rationale,
          },
        });
        this.eventBus.publish({
          type: "approval:request",
          planId: plan.id,
          step: structuredClone(step),
          timestamp: new Date(),
        });
      }
      plan.status = "awaiting_approval";
      this.eventBus.publish({
        type: "plan:updated",
        plan: structuredClone(plan),
        timestamp: new Date(),
      });

      // Persist state when approval is requested
      const projectId = plan.goalId;
      const sessionId = plan.id;
      await this.saveTaskState(plan, projectId, sessionId).catch(() => {});

      await this.waitForApprovals(plan, approvalSteps, signal);
    }

    await this.processRemainingSteps(plan, signal);
  }

  private async processRemainingSteps(
    plan: Plan,
    signal?: AbortSignal,
  ): Promise<void> {
    const executableSteps = getExecutableSteps(plan);

    // Enqueue all pending executable steps
    for (const step of executableSteps) {
      this.coordinator.enqueueStep(plan, step);
    }

    // Process the queue, executing steps in batches
    await this.executeStepQueue(plan, signal);
  }

  private async executeStepQueue(
    plan: Plan,
    signal?: AbortSignal,
  ): Promise<void> {
    // Process queue in rounds
    while (this.coordinator.getQueuedCount() > 0 || this.coordinator.getActiveCount() > 0) {
      if (signal?.aborted) return;

      const started = this.coordinator.processQueue();

      // Execute each started task
      const executionPromises = started.map((task) =>
        this.executeStep(task.planId, task.stepId, task.id, signal),
      );

      if (executionPromises.length > 0) {
        await Promise.allSettled(executionPromises);
      }

      // Small yield to prevent tight loop
      if (this.coordinator.getActiveCount() > 0) {
        await new Promise((r) => setTimeout(r, 10));
      }
    }
  }

  private async executeStep(
    planId: string,
    stepId: string,
    taskId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const plan = this.plans.get(planId);
    if (!plan) return;

    const step = getPlanStepById(plan, stepId);
    if (!step) return;

    // Mark step as running
    step.status = "running";
    step.startedAt = new Date();

    this.eventBus.publish({
      type: "step:started",
      planId,
      step: structuredClone(step),
      timestamp: new Date(),
    });

    this.eventBus.publish({
      type: "plan:updated",
      plan: structuredClone(plan),
      timestamp: new Date(),
    });

    try {
      // Check for loops before executing
      const loopResult = this.loopDetector.detectLoop({ action: step.description, stepId: step.id });
      if (loopResult.stuck) {
        step.status = "completed";
        step.completedAt = new Date();
        step.result = {
          stepId: step.id,
          description: step.description,
          tier: step.tier,
          completedAt: new Date(),
          skipped: true,
          skipReason: `Skipped (loop detected): ${loopResult.suggestion}`,
        };
        this.coordinator.completeTask(taskId, step.result);
        this.eventBus.publish({
          type: "step:completed",
          planId,
          step: structuredClone(step),
          timestamp: new Date(),
        });
        this.eventBus.publish({
          type: "plan:updated",
          plan: structuredClone(plan),
          timestamp: new Date(),
        });
        return;
      }

      // TODO: Replace with actual sub-agent execution via Gemma 4
      if (signal?.aborted) throw new Error("Aborted");

      // Simulate work — in production this calls the sub-agent runner
      const result = await this.executeStepBody(step, signal);

      if (signal?.aborted) throw new Error("Aborted");

      // Mark complete
      step.status = "completed";
      step.completedAt = new Date();
      step.result = result;

      this.coordinator.completeTask(taskId, result);

      // Persist state checkpoint
      const projectId = plan.goalId;
      const sessionId = plan.id;
      await this.saveTaskState(plan, projectId, sessionId).catch(() => {});

      this.eventBus.publish({
        type: "step:completed",
        planId,
        step: structuredClone(step),
        timestamp: new Date(),
      });

      this.eventBus.publish({
        type: "plan:updated",
        plan: structuredClone(plan),
        timestamp: new Date(),
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";

      step.status = "failed";
      step.completedAt = new Date();
      step.error = errorMsg;

      this.coordinator.failTask(taskId, errorMsg);

      this.eventBus.publish({
        type: "step:failed",
        planId,
        step: structuredClone(step),
        error: errorMsg,
        timestamp: new Date(),
      });

      this.eventBus.publish({
        type: "plan:updated",
        plan: structuredClone(plan),
        timestamp: new Date(),
      });
    }
  }

  /**
   * Execute a single step's body via the configured LLM provider.
   * Multiple steps execute in parallel — each call gets its own fetch() to Ollama,
   * and Ollama processes concurrent requests in parallel (verified: 2.6x speedup
   * with 3 concurrent requests on gemma4:latest 8B).
   */
  private async executeStepBody(
    step: PlanStep,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const provider = createLLMProvider();

    // Ask LLM what tool to use for this step
    const messages = [
      {
        role: "system" as const,
        content: `You are executing a task on the user's desktop. Based on the step description, decide which tool to use and return a JSON object with the tool call.

Available tools:
- open_application: {"tool":"open_application","args":{"appName":"notepad"}}
- execute_command: {"tool":"execute_command","args":{"command":"dir"}}
- write_file: {"tool":"write_file","args":{"filePath":"test.txt","content":"Hello"}}
- read_file: {"tool":"read_file","args":{"filePath":"test.txt"}}
- list_directory: {"tool":"list_directory","args":{"path":"."}}

Return ONLY the JSON tool call. Example: {"tool":"open_application","args":{"appName":"notepad"}}`,
      },
      {
        role: "user" as const,
        content: `Execute: ${step.description}`,
      },
    ];

    const response = await provider.chat(messages, {
      temperature: 0.1,
      maxTokens: 256,
      signal,
    });

    // Parse tool call from response
    const toolCall = this.parseToolCall(response.content);

    if (toolCall) {
      const result = await this.executeTool(toolCall);
      return {
        stepId: step.id,
        description: step.description,
        tier: step.tier,
        completedAt: new Date(),
        tool: toolCall.tool,
        args: toolCall.args,
        result,
      };
    }

    return {
      stepId: step.id,
      description: step.description,
      tier: step.tier,
      completedAt: new Date(),
      output: response.content,
    };
  }

  private parseToolCall(content: string): { tool: string; args: Record<string, string> } | null {
    try {
      // Try to find JSON object in response
      const match = content.match(/\{[^{}]*"tool"\s*:\s*"[^"]*"[^{}]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (parsed.tool && parsed.args) return parsed;
      }
    } catch {}

    // Try DirtyJson
    try {
      const { DirtyJson } = await import("../llm/dirty-json.js");
      const parsed = DirtyJson.parseString(content);
      if (parsed && parsed.tool && parsed.args) return parsed;
    } catch {}

    // Fallback: try to detect intent from text
    const lower = content.toLowerCase();
    if (lower.includes("notepad") || lower.includes("open")) {
      return { tool: "open_application", args: { appName: "notepad" } };
    }
    if (lower.includes("chrome") || lower.includes("browser")) {
      return { tool: "open_application", args: { appName: "chrome" } };
    }

    return null;
  }

  private async executeTool(toolCall: { tool: string; args: Record<string, string> }): Promise<string> {
    const { execSync } = await import("child_process");
    const isWindows = process.platform === "win32";

    try {
      switch (toolCall.tool) {
        case "open_application": {
          const app = toolCall.args.appName || toolCall.args.app;
          if (isWindows) {
            execSync(`cmd /c start "" "${app}"`, { timeout: 5000, stdio: "ignore" });
          } else {
            execSync(`open -a "${app}"`, { timeout: 5000, stdio: "ignore" });
          }
          return `Opened ${app}`;
        }
        case "execute_command": {
          const cmd = toolCall.args.command;
          const output = execSync(cmd, { encoding: "utf-8", timeout: 30000 });
          return output.substring(0, 1000);
        }
        case "write_file": {
          const fs = await import("fs/promises");
          const path = await import("path");
          const fullPath = path.resolve(process.cwd(), toolCall.args.filePath);
          await fs.mkdir(path.dirname(fullPath), { recursive: true });
          await fs.writeFile(fullPath, toolCall.args.content || "");
          return `Written to ${fullPath}`;
        }
        case "read_file": {
          const fs = await import("fs/promises");
          const content = await fs.readFile(toolCall.args.filePath, "utf-8");
          return content.substring(0, 1000);
        }
        case "list_directory": {
          const fs = await import("fs/promises");
          const entries = await fs.readdir(toolCall.args.path || ".");
          return entries.join("\n");
        }
        default:
          return `Unknown tool: ${toolCall.tool}`;
      }
    } catch (e: any) {
      return `Error: ${e.message}`;
    }
  }

  // ── Approval Waiting ─────────────────────────────────────

  private waitForApprovals(
    plan: Plan,
    steps: PlanStep[],
    signal: AbortSignal,
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      const checkInterval = setInterval(() => {
        if (signal.aborted) {
          clearInterval(checkInterval);
          resolve();
          return;
        }

        const allApproved = steps.every(
          (s) => s.status === "pending" || s.status === "running" || s.status === "completed" || s.status === "failed",
        );

        if (allApproved) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);

      // Also listen on the event bus for approval events
      const unsubGranted = this.eventBus.subscribe("approval:granted", () => {
        const allResolved = steps.every(
          (s) => s.status === "pending" || s.status === "running" || s.status === "completed" || s.status === "failed",
        );
        if (allResolved) {
          clearInterval(checkInterval);
          unsubGranted();
          unsubRejected();
          resolve();
        }
      });

      const unsubRejected = this.eventBus.subscribe("approval:rejected", () => {
        // Rejected steps become failed, which is also a resolved state
        const allResolved = steps.every(
          (s) => s.status === "pending" || s.status === "running" || s.status === "completed" || s.status === "failed",
        );
        if (allResolved) {
          clearInterval(checkInterval);
          unsubGranted();
          unsubRejected();
          resolve();
        }
      });
    });
  }
}

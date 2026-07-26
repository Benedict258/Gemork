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
import { OllamaProvider } from "../llm/ollama-provider.js";
import { LlamaCppProvider } from "../llm/llamacpp-provider.js";
import { LLMPlanGeneratorImpl } from "../llm/plan-generator.js";
import type { LLMProvider } from "../llm/provider.js";

// ─── LLM Integration ───────────────────────────────────────

export interface LLMPlanOutput {
  description: string;
  tier: StepTier;
  connectorId?: string;
  rationale?: string;
}

export interface LLMPlanGenerator {
  generatePlan(goal: string): Promise<LLMPlanOutput[]>;
}

/**
 * Create an LLM provider from config.
 * Falls back gracefully if the provider is unreachable.
 */
export function createLLMProvider(): LLMProvider {
  const config = loadLLMConfig();
  switch (config.provider) {
    case "llamacpp":
      return new LlamaCppProvider(config);
    case "ollama":
    default:
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
  private plans: Map<string, Plan> = new Map();
  private goals: Map<string, Goal> = new Map();
  private activeRuns: Map<string, AbortController> = new Map();

  constructor(config?: TaskEngineConfig) {
    this.eventBus = new OrchestratorEventBus();
    this.coordinator = new SubAgentCoordinator({
      maxConcurrency: config?.maxConcurrency ?? 3,
    });
    this.coordinator.attachEventBus(this.eventBus);
    this.llmGenerator = config?.llmGenerator ?? createPlanGenerator();
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
    const outputs = await this.llmGenerator.generatePlan(goal.text);

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
    // First pass: handle tier-3 approval gates
    const approvalSteps = getApprovalRequiredSteps(plan);
    if (approvalSteps.length > 0 && !autoApprove) {
      for (const step of approvalSteps) {
        step.status = "awaiting_approval";
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

      // Wait for approvals before continuing
      await this.waitForApprovals(plan, approvalSteps, signal);
    }

    // Process executable steps (tier 1/2)
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
   * Execute a single step's body.
   * TODO: Wire to actual sub-agent runner with Gemma 4.
   */
  private async executeStepBody(
    step: PlanStep,
    signal?: AbortSignal,
  ): Promise<unknown> {
    void signal;
    // Mock execution with realistic delay
    await new Promise((resolve) => setTimeout(resolve, 50 + Math.random() * 200));
    return {
      stepId: step.id,
      description: step.description,
      tier: step.tier,
      completedAt: new Date(),
      mock: true,
    };
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

import { EventEmitter } from "events";
import { v4 as uuid } from "uuid";
import type { Plan, PlanStep } from "./plan.js";
import type { OrchestratorEventBus } from "./event-bus.js";

// ─── Sub-Agent Task Types ────────────────────────────────────

export type SubAgentStatus = "queued" | "running" | "completed" | "failed";

export interface SubAgentTask {
  id: string;
  planId: string;
  stepId: string;
  step: PlanStep;
  status: SubAgentStatus;
  agentId: string;
  result?: unknown;
  error?: string;
  queuedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export interface SubAgentTaskResult {
  taskId: string;
  success: boolean;
  result?: unknown;
  error?: string;
}

// ─── Sub-Agent Coordinator ───────────────────────────────────

export interface SubAgentCoordinatorOptions {
  maxConcurrency?: number;
}

export class SubAgentCoordinator extends EventEmitter {
  private tasks: Map<string, SubAgentTask> = new Map();
  private stepToTask: Map<string, string> = new Map();
  private queue: string[] = [];
  private maxConcurrency: number;
  private eventBus?: OrchestratorEventBus;

  constructor(opts?: SubAgentCoordinatorOptions) {
    super();
    this.maxConcurrency = opts?.maxConcurrency ?? 3;
  }

  attachEventBus(bus: OrchestratorEventBus): void {
    this.eventBus = bus;
  }

  // ── Queue Management ─────────────────────────────────────

  enqueueStep(plan: Plan, step: PlanStep): SubAgentTask {
    if (this.stepToTask.has(step.id)) {
      throw new Error(`Step ${step.id} already has an assigned task`);
    }

    const task: SubAgentTask = {
      id: uuid(),
      planId: plan.id,
      stepId: step.id,
      step,
      status: "queued",
      agentId: `agent-${uuid().slice(0, 8)}`,
      queuedAt: new Date(),
    };

    this.tasks.set(task.id, task);
    this.stepToTask.set(step.id, task.id);
    this.queue.push(task.id);

    this.eventBus?.publish({
      type: "subagent:queued",
      planId: plan.id,
      stepId: step.id,
      agentId: task.agentId,
      timestamp: new Date(),
    });

    this.emit("task:queued", task);
    return task;
  }

  // ── Lifecycle ────────────────────────────────────────────

  startTask(taskId: string): SubAgentTask {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    if (task.status !== "queued") {
      throw new Error(
        `Task ${taskId} cannot start: current status is ${task.status}`,
      );
    }
    if (this.getActiveCount() >= this.maxConcurrency) {
      throw new Error(
        `Max concurrency (${this.maxConcurrency}) reached. Active: ${this.getActiveCount()}`,
      );
    }

    task.status = "running";
    task.startedAt = new Date();

    this.eventBus?.publish({
      type: "subagent:running",
      planId: task.planId,
      stepId: task.stepId,
      agentId: task.agentId,
      timestamp: new Date(),
    });

    this.emit("task:started", task);
    return task;
  }

  completeTask(taskId: string, result?: unknown): SubAgentTask {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    if (task.status !== "running") {
      throw new Error(
        `Task ${taskId} cannot complete: current status is ${task.status}`,
      );
    }

    task.status = "completed";
    task.result = result;
    task.completedAt = new Date();

    this.eventBus?.publish({
      type: "subagent:completed",
      planId: task.planId,
      stepId: task.stepId,
      agentId: task.agentId,
      result: result ?? null,
      timestamp: new Date(),
    });

    this.emit("task:completed", task);
    return task;
  }

  failTask(taskId: string, error: string): SubAgentTask {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    task.status = "failed";
    task.error = error;
    task.completedAt = new Date();

    this.eventBus?.publish({
      type: "subagent:failed",
      planId: task.planId,
      stepId: task.stepId,
      agentId: task.agentId,
      error,
      timestamp: new Date(),
    });

    this.emit("task:failed", task);
    return task;
  }

  // ── Queue Processing ─────────────────────────────────────

  processQueue(): SubAgentTask[] {
    const started: SubAgentTask[] = [];

    while (
      this.queue.length > 0 &&
      this.getActiveCount() < this.maxConcurrency
    ) {
      const taskId = this.queue.shift()!;
      const task = this.tasks.get(taskId);
      if (task && task.status === "queued") {
        this.startTask(taskId);
        started.push(task);
      }
    }

    return started;
  }

  // ── Queries ──────────────────────────────────────────────

  getActiveCount(): number {
    return Array.from(this.tasks.values()).filter(
      (t) => t.status === "running",
    ).length;
  }

  getQueuedCount(): number {
    return this.queue.length;
  }

  getTask(taskId: string): SubAgentTask | undefined {
    return this.tasks.get(taskId);
  }

  getTaskByStepId(stepId: string): SubAgentTask | undefined {
    const taskId = this.stepToTask.get(stepId);
    return taskId ? this.tasks.get(taskId) : undefined;
  }

  getTasksForPlan(planId: string): SubAgentTask[] {
    return Array.from(this.tasks.values()).filter(
      (t) => t.planId === planId,
    );
  }

  getAllTasks(): SubAgentTask[] {
    return Array.from(this.tasks.values());
  }

  // ── Aggregate Results ────────────────────────────────────

  aggregatePlanResults(planId: string): Map<string, SubAgentTaskResult> {
    const results = new Map<string, SubAgentTaskResult>();
    const tasks = this.getTasksForPlan(planId);

    for (const task of tasks) {
      results.set(task.stepId, {
        taskId: task.id,
        success: task.status === "completed",
        result: task.result,
        error: task.error,
      });
    }

    return results;
  }

  // ── Lifecycle ────────────────────────────────────────────

  reset(): void {
    this.tasks.clear();
    this.stepToTask.clear();
    this.queue = [];
  }
}

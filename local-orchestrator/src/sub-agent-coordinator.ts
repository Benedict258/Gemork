import { EventEmitter } from "events";
import { type Plan, type PlanStep } from "./types.js";

export interface SubAgentTask {
  id: string;
  planId: string;
  step: PlanStep;
  status: "queued" | "running" | "completed" | "failed";
}

export class SubAgentCoordinator extends EventEmitter {
  private tasks: Map<string, SubAgentTask> = new Map();
  private maxConcurrency: number;

  constructor(maxConcurrency = 3) {
    super();
    this.maxConcurrency = maxConcurrency;
  }

  async assignStep(plan: Plan, step: PlanStep): Promise<SubAgentTask> {
    if (this.getActiveCount() >= this.maxConcurrency) {
      throw new Error("Max sub-agent concurrency reached");
    }

    const task: SubAgentTask = {
      id: crypto.randomUUID(),
      planId: plan.id,
      step,
      status: "queued",
    };

    this.tasks.set(task.id, task);
    this.emit("task:queued", task);
    return task;
  }

  async startTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    task.status = "running";
    this.emit("task:started", task);
  }

  async completeTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    task.status = "completed";
    this.emit("task:completed", task);
  }

  getActiveCount(): number {
    return Array.from(this.tasks.values()).filter((t) => t.status === "running").length;
  }

  getAllTasks(): SubAgentTask[] {
    return Array.from(this.tasks.values());
  }
}

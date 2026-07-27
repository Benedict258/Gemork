import { EventEmitter } from "events";
import { Scheduler, type Schedule } from "./scheduler.js";
import { BuildContextMemory } from "../storage/build-context-memory.js";

export type SchedulerEngineEvent =
  | { type: "schedule:triggered"; schedule: Schedule; timestamp: Date }
  | { type: "schedule:completed"; schedule: Schedule; timestamp: Date }
  | { type: "schedule:failed"; schedule: Schedule; error: string; timestamp: Date };

export interface SchedulerEngineConfig {
  checkIntervalMs?: number;
}

export class SchedulerEngine {
  private scheduler: Scheduler;
  private memory: BuildContextMemory;
  private eventBus = new EventEmitter();
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(config?: SchedulerEngineConfig) {
    this.scheduler = new Scheduler();
    this.memory = new BuildContextMemory();
    void config;
  }

  getScheduler(): Scheduler {
    return this.scheduler;
  }

  on(
    event: SchedulerEngineEvent["type"],
    handler: (event: SchedulerEngineEvent) => void | Promise<void>,
  ): () => void {
    this.eventBus.on(event, handler);
    return () => this.eventBus.off(event, handler);
  }

  start(checkIntervalMs = 60_000): void {
    if (this.running) return;
    this.running = true;

    this.intervalId = setInterval(() => {
      this.checkDue().catch((err) => {
        console.error("[scheduler-engine] Error checking due schedules:", err);
      });
    }, checkIntervalMs);

    // Run initial check immediately
    this.checkDue().catch((err) => {
      console.error("[scheduler-engine] Error in initial check:", err);
    });
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.running = false;
  }

  async checkDue(): Promise<Schedule[]> {
    const dueSchedules = this.scheduler.getDueSchedules();
    const triggered: Schedule[] = [];

    for (const schedule of dueSchedules) {
      try {
        const updated = await this.scheduler.triggerSchedule(schedule.id);
        if (!updated) continue;

        this.eventBus.emit("schedule:triggered", {
          type: "schedule:triggered",
          schedule: updated,
          timestamp: new Date(),
        } as SchedulerEngineEvent);

        await this.memory.log({
          agentId: "scheduler-engine",
          action: `Triggered schedule: ${schedule.goal}`,
          rationale: `Cron: ${schedule.cron}`,
          projectId: schedule.projectId,
        });

        triggered.push(updated);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Unknown error";

        this.eventBus.emit("schedule:failed", {
          type: "schedule:failed",
          schedule,
          error: errorMsg,
          timestamp: new Date(),
        } as SchedulerEngineEvent);

        await this.memory.log({
          agentId: "scheduler-engine",
          action: `Failed schedule: ${schedule.goal}`,
          rationale: errorMsg,
          projectId: schedule.projectId,
        });
      }
    }

    return triggered;
  }
}

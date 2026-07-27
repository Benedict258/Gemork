import { v4 as uuid } from "uuid";
import { mkdir, readFile, writeFile, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";

const MEMORY_ROOT = ".gemork";

export type SimpleCron =
  | "daily"
  | "weekly"
  | "hourly"
  | `every ${number} hours`
  | `every ${number} minutes`;

export interface Schedule {
  id: string;
  projectId: string;
  workflowId?: string;
  goal: string;
  cron: SimpleCron;
  enabled: boolean;
  lastRun?: string;
  nextRun: string;
}

function schedulesDir(projectId: string): string {
  return join(process.cwd(), MEMORY_ROOT, projectId, "schedules");
}

function scheduleFilePath(projectId: string, scheduleId: string): string {
  return join(schedulesDir(projectId), `${scheduleId}.json`);
}

async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

export function parseSimpleCron(cron: SimpleCron, from?: Date): number {
  const base = from ?? new Date();
  const ms = base.getTime();

  switch (cron) {
    case "daily":
      return ms + 24 * 60 * 60 * 1000;
    case "weekly":
      return ms + 7 * 24 * 60 * 60 * 1000;
    case "hourly":
      return ms + 60 * 60 * 1000;
    default: {
      const hoursMatch = cron.match(/^every (\d+) hours$/);
      if (hoursMatch) {
        const hours = parseInt(hoursMatch[1], 10);
        return ms + hours * 60 * 60 * 1000;
      }
      const minsMatch = cron.match(/^every (\d+) minutes$/);
      if (minsMatch) {
        const mins = parseInt(minsMatch[1], 10);
        return ms + mins * 60 * 1000;
      }
      // Default: 1 hour
      return ms + 60 * 60 * 1000;
    }
  }
}

export class Scheduler {
  private schedules: Map<string, Schedule> = new Map();

  async loadFromDisk(projectId: string): Promise<void> {
    const dir = schedulesDir(projectId);
    try {
      const entries = await readdir(dir);
      for (const file of entries.filter((e) => e.endsWith(".json"))) {
        try {
          const raw = await readFile(join(dir, file), "utf-8");
          const schedule = JSON.parse(raw) as Schedule;
          this.schedules.set(schedule.id, schedule);
        } catch {
          // Skip corrupt files
        }
      }
    } catch {
      // No schedules dir yet
    }
  }

  async schedule(schedule: Omit<Schedule, "id" | "nextRun">): Promise<string> {
    const id = uuid();
    const full: Schedule = {
      ...schedule,
      id,
      nextRun: new Date(parseSimpleCron(schedule.cron)).toISOString(),
    };

    this.schedules.set(id, full);

    const dir = schedulesDir(schedule.projectId);
    await ensureDir(dir);
    const filePath = scheduleFilePath(schedule.projectId, id);
    await writeFile(filePath, JSON.stringify(full, null, 2), "utf-8");

    return id;
  }

  async unschedule(scheduleId: string): Promise<boolean> {
    const schedule = this.schedules.get(scheduleId);
    if (!schedule) return false;

    this.schedules.delete(scheduleId);

    const filePath = scheduleFilePath(schedule.projectId, scheduleId);
    try {
      await unlink(filePath);
    } catch {
      // Ignore
    }
    return true;
  }

  getSchedules(): Schedule[] {
    return Array.from(this.schedules.values()).sort(
      (a, b) => new Date(a.nextRun).getTime() - new Date(b.nextRun).getTime(),
    );
  }

  getSchedule(scheduleId: string): Schedule | undefined {
    return this.schedules.get(scheduleId);
  }

  getNextRun(scheduleId: string): Date | null {
    const schedule = this.schedules.get(scheduleId);
    if (!schedule) return null;
    return new Date(schedule.nextRun);
  }

  async triggerSchedule(scheduleId: string): Promise<Schedule | null> {
    const schedule = this.schedules.get(scheduleId);
    if (!schedule) return null;

    schedule.lastRun = new Date().toISOString();
    schedule.nextRun = new Date(parseSimpleCron(schedule.cron)).toISOString();

    const filePath = scheduleFilePath(schedule.projectId, scheduleId);
    await writeFile(filePath, JSON.stringify(schedule, null, 2), "utf-8");

    return schedule;
  }

  getDueSchedules(): Schedule[] {
    const now = Date.now();
    return this.getSchedules().filter(
      (s) => s.enabled && new Date(s.nextRun).getTime() <= now,
    );
  }
}

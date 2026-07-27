import { writeFile, readFile, unlink, mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export interface TaskState {
  sessionId: string;
  planId?: string;
  goalId?: string;
  currentStepIndex: number;
  completedSteps: string[];
  pendingApprovals: string[];
  startedAt: string;
  lastCheckpoint: string;
}

const MEMORY_ROOT = ".gemork";

function stateDir(projectId: string, sessionId: string): string {
  return join(process.cwd(), MEMORY_ROOT, projectId, "sessions", sessionId);
}

function statePath(projectId: string, sessionId: string): string {
  return join(stateDir(projectId, sessionId), "state.json");
}

async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

async function atomicWriteFile(filePath: string, content: string): Promise<void> {
  const tmpPath = `${filePath}.tmp.${randomUUID()}`;
  await writeFile(tmpPath, content, "utf-8");
  await rename(tmpPath, filePath);
}

export class StateSaver {
  async saveState(
    projectId: string,
    sessionId: string,
    state: TaskState,
  ): Promise<void> {
    const dir = stateDir(projectId, sessionId);
    await ensureDir(dir);

    const filePath = statePath(projectId, sessionId);
    const data: TaskState = {
      ...state,
      lastCheckpoint: new Date().toISOString(),
    };

    await atomicWriteFile(filePath, JSON.stringify(data, null, 2));
  }

  async loadState(
    projectId: string,
    sessionId: string,
  ): Promise<TaskState | null | "corrupted"> {
    const filePath = statePath(projectId, sessionId);
    try {
      const raw = await readFile(filePath, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.sessionId === "string" && typeof parsed.currentStepIndex === "number") {
        return parsed as TaskState;
      }
      return "corrupted";
    } catch {
      try {
        await readFile(filePath, "utf-8");
        return "corrupted";
      } catch {
        return null;
      }
    }
  }

  async clearState(
    projectId: string,
    sessionId: string,
  ): Promise<boolean> {
    const filePath = statePath(projectId, sessionId);
    try {
      await unlink(filePath);
      return true;
    } catch {
      return false;
    }
  }
}

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface MemoryEntry {
  id: string;
  agentId: string;
  action: string;
  rationale: string;
  timestamp: string;
  projectId: string;
  stepId?: string;
}

const MEMORY_ROOT = ".gemork";

async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

function memoryFilePath(projectId: string): string {
  return join(process.cwd(), MEMORY_ROOT, projectId, "Build-Context-Memory.json");
}

async function readMemoryFile(projectId: string): Promise<MemoryEntry[]> {
  const filePath = memoryFilePath(projectId);
  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeMemoryFile(projectId: string, entries: MemoryEntry[]): Promise<void> {
  const filePath = memoryFilePath(projectId);
  await ensureDir(join(process.cwd(), MEMORY_ROOT, projectId));
  await writeFile(filePath, JSON.stringify(entries, null, 2), "utf-8");
}

export class BuildContextMemory {
  async log(
    entry: Omit<MemoryEntry, "id" | "timestamp">
  ): Promise<MemoryEntry> {
    const full: MemoryEntry = {
      ...entry,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
    };

    const entries = await readMemoryFile(entry.projectId);
    entries.push(full);
    await writeMemoryFile(entry.projectId, entries);

    return full;
  }

  async queryByProject(projectId: string): Promise<MemoryEntry[]> {
    return readMemoryFile(projectId);
  }

  async queryByAgent(agentId: string, projectId?: string): Promise<MemoryEntry[]> {
    const projectIds = projectId ? [projectId] : await this.getAllProjectIds();
    const results: MemoryEntry[] = [];

    for (const pid of projectIds) {
      const entries = await readMemoryFile(pid);
      for (const entry of entries) {
        if (entry.agentId === agentId) results.push(entry);
      }
    }

    return results.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime() || b.id.localeCompare(a.id)
    );
  }

  async queryRecent(limit: number, projectId?: string): Promise<MemoryEntry[]> {
    const projectIds = projectId ? [projectId] : await this.getAllProjectIds();
    const results: MemoryEntry[] = [];

    for (const pid of projectIds) {
      const entries = await readMemoryFile(pid);
      results.push(...entries);
    }

    return results
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime() || b.id.localeCompare(a.id))
      .slice(0, limit);
  }

  async queryByStep(stepId: string, projectId: string): Promise<MemoryEntry[]> {
    const entries = await readMemoryFile(projectId);
    return entries.filter((e) => e.stepId === stepId);
  }

  async deleteEntry(entryId: string, projectId: string): Promise<boolean> {
    const entries = await readMemoryFile(projectId);
    const idx = entries.findIndex((e) => e.id === entryId);
    if (idx === -1) return false;
    entries.splice(idx, 1);
    await writeMemoryFile(projectId, entries);
    return true;
  }

  async getEntryCount(projectId: string): Promise<number> {
    const entries = await readMemoryFile(projectId);
    return entries.length;
  }

  private async getAllProjectIds(): Promise<string[]> {
    // Scan .gemork/ for directories that contain Build-Context-Memory.json
    const { readdir } = await import("node:fs/promises");
    const baseDir = join(process.cwd(), MEMORY_ROOT);

    try {
      const entries = await readdir(baseDir, { withFileTypes: true });
      return entries
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      return [];
    }
  }
}

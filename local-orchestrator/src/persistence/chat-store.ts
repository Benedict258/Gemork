import { randomUUID } from "node:crypto";
import { appendFile, readFile, readdir, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

export interface ChatEntry {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

const MEMORY_ROOT = ".gemork";

function sessionDir(projectId: string, sessionId: string): string {
  return join(process.cwd(), MEMORY_ROOT, projectId, "sessions", sessionId);
}

function conversationPath(projectId: string, sessionId: string): string {
  return join(sessionDir(projectId, sessionId), "conversation.jsonl");
}

async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

function parseJsonlLine(line: string): ChatEntry | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as ChatEntry;
  } catch {
    return null;
  }
}

export class ChatStore {
  async appendEntry(
    projectId: string,
    sessionId: string,
    entry: Omit<ChatEntry, "id" | "timestamp">,
  ): Promise<ChatEntry> {
    const full: ChatEntry = {
      ...entry,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
    };

    const dir = sessionDir(projectId, sessionId);
    await ensureDir(dir);

    const filePath = conversationPath(projectId, sessionId);
    const line = JSON.stringify(full) + "\n";
    await appendFile(filePath, line, "utf-8");

    return full;
  }

  async getEntries(
    projectId: string,
    sessionId: string,
    limit?: number,
  ): Promise<ChatEntry[]> {
    const filePath = conversationPath(projectId, sessionId);
    let raw: string;
    try {
      raw = await readFile(filePath, "utf-8");
    } catch {
      return [];
    }

    const lines = raw.split("\n");
    const entries: ChatEntry[] = [];
    for (const line of lines) {
      const entry = parseJsonlLine(line);
      if (entry) entries.push(entry);
    }

    if (limit !== undefined && limit > 0) {
      return entries.slice(-limit);
    }
    return entries;
  }

  async getSessionIds(projectId: string): Promise<string[]> {
    const sessionsDir = join(
      process.cwd(),
      MEMORY_ROOT,
      projectId,
      "sessions",
    );
    try {
      const entries = await readdir(sessionsDir, { withFileTypes: true });
      return entries
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort();
    } catch {
      return [];
    }
  }

  async deleteSession(projectId: string, sessionId: string): Promise<boolean> {
    const dir = sessionDir(projectId, sessionId);
    try {
      await rm(dir, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  }

  async getLatestSession(projectId: string): Promise<string | null> {
    const ids = await this.getSessionIds(projectId);
    return ids.length > 0 ? ids[ids.length - 1] : null;
  }
}

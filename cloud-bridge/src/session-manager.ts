import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { v4 as uuidv4 } from "uuid";

export interface Session {
  id: string;
  createdAt: number;
  lastActivity: number;
  connectedClients: number;
  orchestratorConnected: boolean;
}

const SESSIONS_PATH = join(process.cwd(), "sessions.json");
let sessions: Map<string, Session> = new Map();

function loadSessions(): void {
  if (existsSync(SESSIONS_PATH)) {
    try {
      const data = JSON.parse(readFileSync(SESSIONS_PATH, "utf-8"));
      for (const s of data) {
        sessions.set(s.id, s);
      }
    } catch {
      // corrupted file, start fresh
    }
  }
}

function persistSessions(): void {
  const arr = Array.from(sessions.values());
  writeFileSync(SESSIONS_PATH, JSON.stringify(arr, null, 2), "utf-8");
}

// load on import
loadSessions();

export function createSession(): string {
  const id = uuidv4();
  const now = Date.now();
  const session: Session = {
    id,
    createdAt: now,
    lastActivity: now,
    connectedClients: 0,
    orchestratorConnected: false,
  };
  sessions.set(id, session);
  persistSessions();
  return id;
}

export function getSession(id: string): Session | null {
  return sessions.get(id) ?? null;
}

export function listSessions(): Session[] {
  return Array.from(sessions.values());
}

export function updateActivity(id: string): void {
  const s = sessions.get(id);
  if (s) {
    s.lastActivity = Date.now();
    persistSessions();
  }
}

export function setConnectedClients(id: string, count: number): void {
  const s = sessions.get(id);
  if (s) {
    s.connectedClients = count;
    persistSessions();
  }
}

export function setOrchestratorConnected(id: string, connected: boolean): void {
  const s = sessions.get(id);
  if (s) {
    s.orchestratorConnected = connected;
    persistSessions();
  }
}

export function removeSession(id: string): boolean {
  const deleted = sessions.delete(id);
  if (deleted) persistSessions();
  return deleted;
}

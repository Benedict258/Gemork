export interface MemoryEntry {
  id: string;
  agentId: string;
  action: string;
  rationale: string;
  timestamp: Date;
  projectId: string;
}

export class MemoryStore {
  private entries: MemoryEntry[] = [];

  async log(entry: Omit<MemoryEntry, "id" | "timestamp">): Promise<MemoryEntry> {
    const full: MemoryEntry = {
      ...entry,
      id: crypto.randomUUID(),
      timestamp: new Date(),
    };
    this.entries.push(full);
    return full;
  }

  async queryByProject(projectId: string): Promise<MemoryEntry[]> {
    return this.entries.filter((e) => e.projectId === projectId);
  }

  async queryByAgent(agentId: string): Promise<MemoryEntry[]> {
    return this.entries.filter((e) => e.agentId === agentId);
  }

  async queryRecent(limit: number): Promise<MemoryEntry[]> {
    return this.entries
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }
}

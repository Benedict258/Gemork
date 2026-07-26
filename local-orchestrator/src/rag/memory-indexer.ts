import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { EmbeddingProvider } from "./embedding-provider.js";
import { VectorStore } from "./vector-store.js";
import type { BuildContextMemory, MemoryEntry } from "../storage/build-context-memory.js";

const MEMORY_ROOT = ".gemork";

export interface IndexOptions {
  projectId: string;
  embeddingProvider: EmbeddingProvider;
  buildContextMemory: BuildContextMemory;
}

export class MemoryIndexer {
  private embeddingProvider: EmbeddingProvider;
  private buildContextMemory: BuildContextMemory;

  constructor(opts: IndexOptions) {
    this.embeddingProvider = opts.embeddingProvider;
    this.buildContextMemory = opts.buildContextMemory;
  }

  async indexProjectMemory(projectId: string): Promise<number> {
    const store = new VectorStore(projectId);
    try {
      const entries = await this.buildContextMemory.queryByProject(projectId);
      let indexed = 0;

      for (const entry of entries) {
        const text = this.memoryEntryToText(entry);
        if (store.hasContent(projectId, text)) continue;

        const embedding = await this.embeddingProvider.embed(text);
        store.add(projectId, text, embedding, {
          type: "memory",
          agentId: entry.agentId,
          action: entry.action,
          entryId: entry.id,
          timestamp: entry.timestamp,
          stepId: entry.stepId,
        });
        indexed++;
      }

      return indexed;
    } finally {
      store.close();
    }
  }

  async indexFile(
    projectId: string,
    filePath: string,
    content: string,
  ): Promise<string | null> {
    const store = new VectorStore(projectId);
    try {
      if (store.hasContent(projectId, content)) return null;

      const embedding = await this.embeddingProvider.embed(content);
      const id = store.add(projectId, content, embedding, {
        type: "file",
        filePath,
      });
      return id;
    } finally {
      store.close();
    }
  }

  async indexPlanResult(
    projectId: string,
    plan: {
      id: string;
      goalId: string;
      steps: Array<{ description: string; tier: number; status: string; result?: unknown }>;
      status: string;
    },
  ): Promise<string | null> {
    const store = new VectorStore(projectId);
    try {
      const text = this.planToText(plan);
      if (store.hasContent(projectId, text)) return null;

      const embedding = await this.embeddingProvider.embed(text);
      const id = store.add(projectId, text, embedding, {
        type: "plan",
        planId: plan.id,
        goalId: plan.goalId,
        status: plan.status,
        stepCount: plan.steps.length,
      });
      return id;
    } finally {
      store.close();
    }
  }

  async indexFromJsonFile(
    projectId: string,
    filePath: string,
  ): Promise<number> {
    const store = new VectorStore(projectId);
    try {
      const raw = await readFile(filePath, "utf-8");
      let entries: MemoryEntry[];
      try {
        const parsed = JSON.parse(raw);
        entries = Array.isArray(parsed) ? parsed : [];
      } catch {
        return 0;
      }

      let indexed = 0;
      for (const entry of entries) {
        const text = this.memoryEntryToText(entry);
        if (store.hasContent(projectId, text)) continue;

        const embedding = await this.embeddingProvider.embed(text);
        store.add(projectId, text, embedding, {
          type: "memory",
          agentId: entry.agentId,
          action: entry.action,
          entryId: entry.id,
          timestamp: entry.timestamp,
          stepId: entry.stepId,
        });
        indexed++;
      }

      return indexed;
    } finally {
      store.close();
    }
  }

  private memoryEntryToText(entry: MemoryEntry): string {
    const parts = [
      `Agent ${entry.agentId} performed: ${entry.action}`,
      `Rationale: ${entry.rationale}`,
    ];
    if (entry.stepId) parts.push(`Step: ${entry.stepId}`);
    return parts.join(". ");
  }

  private planToText(plan: {
    id: string;
    steps: Array<{ description: string; tier: number; status: string; result?: unknown }>;
    status: string;
  }): string {
    const stepDescriptions = plan.steps
      .map((s) => `Step (tier ${s.tier}, ${s.status}): ${s.description}`)
      .join("; ");
    return `Plan ${plan.id} (${plan.status}): ${stepDescriptions}`;
  }
}

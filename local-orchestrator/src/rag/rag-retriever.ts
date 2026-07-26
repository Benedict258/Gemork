import type { EmbeddingProvider } from "./embedding-provider.js";
import { VectorStore } from "./vector-store.js";

export interface MemoryEntry {
  content: string;
  metadata: Record<string, unknown>;
  score: number;
}

export interface FileContext {
  filePath: string;
  content: string;
  score: number;
}

export interface PlanContext {
  planId: string;
  content: string;
  score: number;
}

export interface RagContext {
  relevantMemory: MemoryEntry[];
  relevantFiles: FileContext[];
  relevantPlans: PlanContext[];
  projectId: string;
}

export interface RagRetrieverConfig {
  projectId: string;
  embeddingProvider: EmbeddingProvider;
}

export class RagRetriever {
  private projectId: string;
  private embeddingProvider: EmbeddingProvider;

  constructor(config: RagRetrieverConfig) {
    this.projectId = config.projectId;
    this.embeddingProvider = config.embeddingProvider;
  }

  async retrieveContext(goal: string, limit = 10): Promise<RagContext> {
    const store = new VectorStore(this.projectId);
    try {
      const stats = store.getStats(this.projectId);
      if (stats.totalEntries === 0) {
        return { relevantMemory: [], relevantFiles: [], relevantPlans: [], projectId: this.projectId };
      }

      const queryEmbedding = await this.embeddingProvider.embed(goal);
      const results = store.search(this.projectId, queryEmbedding, limit);

      const relevantMemory: MemoryEntry[] = [];
      const relevantFiles: FileContext[] = [];
      const relevantPlans: PlanContext[] = [];

      for (const result of results) {
        const type = result.metadata.type;

        if (type === "memory") {
          relevantMemory.push({
            content: result.content,
            metadata: result.metadata,
            score: result.score,
          });
        } else if (type === "file") {
          relevantFiles.push({
            filePath: String(result.metadata.filePath ?? "unknown"),
            content: result.content,
            score: result.score,
          });
        } else if (type === "plan") {
          relevantPlans.push({
            planId: String(result.metadata.planId ?? "unknown"),
            content: result.content,
            score: result.score,
          });
        }
      }

      return { relevantMemory, relevantFiles, relevantPlans, projectId: this.projectId };
    } finally {
      store.close();
    }
  }
}

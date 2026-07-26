import { createHash } from "node:crypto";

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  dimensions(): number;
}

const EMBEDDING_DIMENSIONS = 384;

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  private baseUrl: string;
  private model: string;

  constructor(baseUrl = "http://localhost:11434", model = "nomic-embed-text") {
    this.baseUrl = baseUrl;
    this.model = model;
  }

  dimensions(): number {
    return EMBEDDING_DIMENSIONS;
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, input: text }),
    });

    if (!response.ok) {
      throw new Error(`Ollama embed failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as { embeddings: number[][] };
    const embedding = data.embeddings?.[0];
    if (!embedding) throw new Error("No embedding returned from Ollama");
    return embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch(`${this.baseUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, input: texts }),
    });

    if (!response.ok) {
      throw new Error(`Ollama embed batch failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as { embeddings: number[][] };
    return data.embeddings ?? [];
  }
}

/**
 * Hash-based fallback embedding provider.
 * Produces deterministic, fixed-size vectors from text content.
 * Not semantically meaningful like real embeddings, but functional for
 * deduplication, basic similarity, and graceful offline operation.
 */
export class SimpleEmbeddingProvider implements EmbeddingProvider {
  private dims: number;

  constructor(dims = EMBEDDING_DIMENSIONS) {
    this.dims = dims;
  }

  dimensions(): number {
    return this.dims;
  }

  async embed(text: string): Promise<number[]> {
    return this.hashToVector(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.hashToVector(t));
  }

  private hashToVector(text: string): number[] {
    const normalized = text.toLowerCase().trim();
    const words = normalized.split(/\s+/);

    // Create multiple hash seeds from content features
    const vectors: number[][] = [];
    for (let i = 0; i < this.dims; i++) {
      const seed = `${normalized}::${i}`;
      const hash = createHash("sha256").update(seed).digest();
      const vec: number[] = [];
      for (let j = 0; j < this.dims; j++) {
        const byteIdx = (i * this.dims + j) % hash.length;
        // Scale to [-1, 1]
        vec.push((hash[byteIdx] / 127.5) - 1);
      }
      vectors.push(vec);
    }

    // Blend with word frequency signal
    const wordVec = new Array(this.dims).fill(0);
    for (const word of words) {
      const wHash = createHash("md5").update(word).digest();
      for (let j = 0; j < this.dims; j++) {
        wordVec[j] += (wHash[j % wHash.length] / 127.5) - 1;
      }
    }

    // Average the hash vectors and blend with word vector
    const result = new Array(this.dims).fill(0);
    for (const vec of vectors) {
      for (let j = 0; j < this.dims; j++) {
        result[j] += vec[j];
      }
    }
    for (let j = 0; j < this.dims; j++) {
      result[j] = (result[j] / vectors.length) * 0.5 + wordVec[j] * 0.5;
    }

    // Normalize to unit vector
    let norm = 0;
    for (let j = 0; j < this.dims; j++) norm += result[j] * result[j];
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let j = 0; j < this.dims; j++) result[j] /= norm;
    }

    return result;
  }
}

/**
 * Try Ollama first, fall back to simple embeddings if unavailable.
 */
export async function createEmbeddingProvider(
  ollamaUrl?: string,
  model?: string,
): Promise<EmbeddingProvider> {
  const provider = new OllamaEmbeddingProvider(ollamaUrl, model);
  try {
    const testEmbed = await provider.embed("test");
    if (testEmbed.length > 0) return provider;
  } catch {
    // Ollama not available, use fallback
  }
  return new SimpleEmbeddingProvider();
}

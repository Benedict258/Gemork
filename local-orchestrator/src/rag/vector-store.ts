import Database from "better-sqlite3";
import { randomUUID, createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const DB_DIR = ".gemork";

export interface VectorEntry {
  id: string;
  projectId: string;
  content: string;
  metadata: Record<string, unknown>;
  embedding: number[];
  contentHash: string;
  createdAt: string;
}

export interface SearchResult extends VectorEntry {
  score: number;
}

export interface VectorStoreStats {
  totalEntries: number;
  lastUpdated: string | null;
}

function getDbPath(projectId: string): string {
  const dir = join(process.cwd(), DB_DIR, projectId);
  mkdirSync(dir, { recursive: true });
  return join(dir, "gemork.db");
}

function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export class VectorStore {
  private db: Database.Database;
  private projectId: string;

  constructor(projectId: string) {
    this.projectId = projectId;
    this.db = new Database(getDbPath(projectId));
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.initSchema();
  }

  close(): void {
    this.db.close();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS vectors (
        id TEXT PRIMARY KEY,
        projectId TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        embedding TEXT NOT NULL,
        contentHash TEXT NOT NULL,
        createdAt TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_vectors_project ON vectors(projectId);
      CREATE INDEX IF NOT EXISTS idx_vectors_hash ON vectors(contentHash);
      CREATE INDEX IF NOT EXISTS idx_vectors_project_hash ON vectors(projectId, contentHash);
    `);
  }

  add(
    projectId: string,
    content: string,
    embedding: number[],
    metadata: Record<string, unknown> = {},
  ): string {
    const id = randomUUID();
    const hash = contentHash(content);
    const stmt = this.db.prepare(`
      INSERT INTO vectors (id, projectId, content, metadata, embedding, contentHash)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      projectId,
      content,
      JSON.stringify(metadata),
      JSON.stringify(embedding),
      hash,
    );
    return id;
  }

  hasContent(projectId: string, content: string): boolean {
    const hash = contentHash(content);
    const stmt = this.db.prepare(
      "SELECT 1 FROM vectors WHERE projectId = ? AND contentHash = ? LIMIT 1"
    );
    return stmt.get(projectId, hash) !== undefined;
  }

  search(projectId: string, queryEmbedding: number[], topK = 5): SearchResult[] {
    const stmt = this.db.prepare(
      "SELECT * FROM vectors WHERE projectId = ?"
    );
    const rows = stmt.all(projectId) as Array<{
      id: string;
      projectId: string;
      content: string;
      metadata: string;
      embedding: string;
      contentHash: string;
      createdAt: string;
    }>;

    const results: SearchResult[] = [];

    for (const row of rows) {
      let embedding: number[];
      try {
        embedding = JSON.parse(row.embedding) as number[];
      } catch {
        continue;
      }

      const score = cosineSimilarity(queryEmbedding, embedding);

      results.push({
        id: row.id,
        projectId: row.projectId,
        content: row.content,
        metadata: JSON.parse(row.metadata) as Record<string, unknown>,
        embedding,
        contentHash: row.contentHash,
        createdAt: row.createdAt,
        score,
      });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  delete(id: string): boolean {
    const stmt = this.db.prepare("DELETE FROM vectors WHERE id = ?");
    const result = stmt.run(id);
    return result.changes > 0;
  }

  deleteProject(projectId: string): boolean {
    const stmt = this.db.prepare("DELETE FROM vectors WHERE projectId = ?");
    const result = stmt.run(projectId);
    return result.changes > 0;
  }

  getStats(projectId: string): VectorStoreStats {
    const countStmt = this.db.prepare(
      "SELECT COUNT(*) as count FROM vectors WHERE projectId = ?"
    );
    const row = countStmt.get(projectId) as { count: number } | undefined;

    const lastStmt = this.db.prepare(
      "SELECT MAX(createdAt) as lastUpdated FROM vectors WHERE projectId = ?"
    );
    const last = lastStmt.get(projectId) as { lastUpdated: string | null } | undefined;

    return {
      totalEntries: row?.count ?? 0,
      lastUpdated: last?.lastUpdated ?? null,
    };
  }

  getAll(projectId: string): VectorEntry[] {
    const stmt = this.db.prepare(
      "SELECT * FROM vectors WHERE projectId = ? ORDER BY createdAt DESC"
    );
    const rows = stmt.all(projectId) as Array<{
      id: string;
      projectId: string;
      content: string;
      metadata: string;
      embedding: string;
      contentHash: string;
      createdAt: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      projectId: row.projectId,
      content: row.content,
      metadata: JSON.parse(row.metadata) as Record<string, unknown>,
      embedding: JSON.parse(row.embedding) as number[],
      contentHash: row.contentHash,
      createdAt: row.createdAt,
    }));
  }
}

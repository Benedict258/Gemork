import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, readdir, unlink, stat } from "node:fs/promises";
import { join, basename, dirname } from "node:path";

export interface Snapshot {
  id: string;
  filePath: string;
  relativePath: string;
  content: Buffer;
  timestamp: Date;
  projectId: string;
}

const MAX_SNAPSHOTS_PER_FILE = 50;
const HISTORY_ROOT = ".gemork/history";

async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

function sanitiseFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export class SnapshotService {
  private snapshotIndex = new Map<string, Snapshot>();

  async capturePreWrite(
    filePath: string,
    content: Buffer,
    projectId: string
  ): Promise<string> {
    const snapshotId = randomUUID();
    const ts = Date.now();
    const name = basename(filePath);
    const safeName = sanitiseFilename(name);
    const relDir = dirname(filePath);

    const historyDir = join(
      process.cwd(),
      HISTORY_ROOT,
      projectId,
      sanitiseFilename(relDir || ".")
    );
    await ensureDir(historyDir);

    const snapshotFileName = `${ts}_${safeName}`;
    const snapshotPath = join(historyDir, snapshotFileName);

    let fileContent: Buffer;
    try {
      fileContent = await readFile(filePath);
    } catch {
      fileContent = Buffer.alloc(0);
    }

    await writeFile(snapshotPath, fileContent);

    const snapshot: Snapshot = {
      id: snapshotId,
      filePath,
      relativePath: snapshotPath,
      content: fileContent,
      timestamp: new Date(ts),
      projectId,
    };
    this.snapshotIndex.set(snapshotId, snapshot);

    await this.enforceRetention(projectId);

    return snapshotId;
  }

  async restore(snapshotId: string): Promise<Buffer | undefined> {
    const snapshot = this.snapshotIndex.get(snapshotId);
    if (!snapshot) return undefined;

    try {
      const onDisk = await readFile(snapshot.relativePath);
      return onDisk;
    } catch {
      return snapshot.content;
    }
  }

  async writeToDisk(snapshotId: string, targetPath: string): Promise<boolean> {
    const snapshot = this.snapshotIndex.get(snapshotId);
    if (!snapshot) return false;

    const content = await this.restore(snapshotId);
    if (!content) return false;

    await ensureDir(dirname(targetPath));
    await writeFile(targetPath, content);
    return true;
  }

  async listSnapshots(projectId: string): Promise<Snapshot[]> {
    const results: Snapshot[] = [];
    for (const snap of this.snapshotIndex.values()) {
      if (snap.projectId === projectId) results.push(snap);
    }
    return results.sort(
      (a, b) => b.timestamp.getTime() - a.timestamp.getTime()
    );
  }

  async deleteSnapshot(snapshotId: string): Promise<boolean> {
    const snapshot = this.snapshotIndex.get(snapshotId);
    if (!snapshot) return false;

    try {
      await unlink(snapshot.relativePath);
    } catch {
      // File already removed — still clear index
    }
    this.snapshotIndex.delete(snapshotId);
    return true;
  }

  async getSnapshotInfo(snapshotId: string): Promise<Snapshot | undefined> {
    return this.snapshotIndex.get(snapshotId);
  }

  private async enforceRetention(projectId: string): Promise<void> {
    const projectSnaps = Array.from(this.snapshotIndex.values())
      .filter((s) => s.projectId === projectId)
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    // Group by original file path
    const byFile = new Map<string, Snapshot[]>();
    for (const snap of projectSnaps) {
      const existing = byFile.get(snap.filePath) ?? [];
      existing.push(snap);
      byFile.set(snap.filePath, existing);
    }

    for (const [, snaps] of byFile) {
      if (snaps.length <= MAX_SNAPSHOTS_PER_FILE) continue;

      const toRemove = snaps.slice(0, snaps.length - MAX_SNAPSHOTS_PER_FILE);
      for (const snap of toRemove) {
        try {
          await unlink(snap.relativePath);
        } catch {
          // Best-effort cleanup
        }
        this.snapshotIndex.delete(snap.id);
      }
    }
  }
}

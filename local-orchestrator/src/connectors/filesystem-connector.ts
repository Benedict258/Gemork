import { readFile, writeFile, stat, readdir, mkdir, rename, copyFile, unlink, access } from "node:fs/promises";
import { resolve, relative, normalize, dirname } from "node:path";
import type { IConnector, ConnectorResult, ConnectorScope } from "./base-connector.js";
import { SnapshotService } from "../storage/snapshot-service.js";

export interface FilesystemConnectorConfig {
  basePath: string;
  allowedPaths?: string[];
  excludedPaths?: string[];
  projectId: string;
  snapshotService?: SnapshotService;
}

const OPERATION_TIMEOUT_MS = 30_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Operation '${label}' timed out after ${ms}ms`)), ms)
    ),
  ]);
}

function isWithinPath(target: string, scope: string): boolean {
  const normTarget = normalize(target);
  const normScope = normalize(scope);
  return normTarget.startsWith(normScope + "/") || normTarget === normScope;
}

function hasTraversalEscape(target: string, basePath: string): boolean {
  const resolved = resolve(basePath, target);
  return !isWithinPath(resolved, basePath);
}

function tierResult(tier: 1 | 2 | 3, result: ConnectorResult): ConnectorResult {
  return { ...result, tier };
}

export class FilesystemConnector implements IConnector {
  readonly id: string;
  readonly name: string;
  readonly type = "filesystem";

  private scope: ConnectorScope;
  private projectId: string;
  private snapshotService: SnapshotService;
  private connected = false;

  constructor(config: FilesystemConnectorConfig) {
    this.id = `fs-${normalize(config.basePath).replace(/[^a-zA-Z0-9]/g, "-")}`;
    this.name = `Filesystem (${config.basePath})`;
    this.scope = {
      basePath: resolve(config.basePath),
      allowedPaths: config.allowedPaths?.map((p) => resolve(p)),
      excludedPaths: config.excludedPaths?.map((p) => resolve(p)),
    };
    this.projectId = config.projectId;
    this.snapshotService = config.snapshotService ?? new SnapshotService();
  }

  async isAvailable(): Promise<boolean> {
    try {
      await access(this.scope.basePath);
      return true;
    } catch {
      return false;
    }
  }

  async connect(): Promise<void> {
    const available = await this.isAvailable();
    if (!available) {
      throw new Error(`Filesystem connector base path not accessible: ${this.scope.basePath}`);
    }
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async read(path: string): Promise<ConnectorResult> {
    this.ensureConnected();
    const resolved = this.resolveAndValidate(path);

    try {
      const content = await withTimeout(readFile(resolved), OPERATION_TIMEOUT_MS, "read");
      return tierResult(1, { success: true, data: content, tier: 1, requiresApproval: false });
    } catch (err) {
      return tierResult(1, {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        tier: 1,
        requiresApproval: false,
      });
    }
  }

  async list(path?: string): Promise<ConnectorResult> {
    this.ensureConnected();
    const resolved = path ? this.resolveAndValidate(path) : this.scope.basePath;

    try {
      const entries = await withTimeout(readdir(resolved, { withFileTypes: true }), OPERATION_TIMEOUT_MS, "list");
      const items = entries.map((e) => ({
        name: e.name,
        isDirectory: e.isDirectory(),
        isFile: e.isFile(),
      }));
      return tierResult(1, { success: true, data: items, tier: 1, requiresApproval: false });
    } catch (err) {
      return tierResult(1, {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        tier: 1,
        requiresApproval: false,
      });
    }
  }

  async stat(path: string): Promise<ConnectorResult> {
    this.ensureConnected();
    const resolved = this.resolveAndValidate(path);

    try {
      const info = await withTimeout(stat(resolved), OPERATION_TIMEOUT_MS, "stat");
      return tierResult(1, {
        success: true,
        data: {
          size: info.size,
          isFile: info.isFile(),
          isDirectory: info.isDirectory(),
          modifiedAt: info.mtime,
          createdAt: info.birthtime,
        },
        tier: 1,
        requiresApproval: false,
      });
    } catch (err) {
      return tierResult(1, {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        tier: 1,
        requiresApproval: false,
      });
    }
  }

  async write(path: string, content: string | Buffer): Promise<ConnectorResult> {
    this.ensureConnected();
    const resolved = this.resolveAndValidate(path);

    try {
      await this.snapshotForWrite(resolved);
      const buf = typeof content === "string" ? Buffer.from(content, "utf-8") : content;
      await withTimeout(writeFile(resolved, buf), OPERATION_TIMEOUT_MS, "write");
      return tierResult(2, { success: true, tier: 2, requiresApproval: false });
    } catch (err) {
      return tierResult(2, {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        tier: 2,
        requiresApproval: false,
      });
    }
  }

  async edit(path: string, oldContent: string, newContent: string): Promise<ConnectorResult> {
    this.ensureConnected();
    const resolved = this.resolveAndValidate(path);

    try {
      const current = await withTimeout(readFile(resolved, "utf-8"), OPERATION_TIMEOUT_MS, "edit-read");
      if (!current.includes(oldContent)) {
        return tierResult(2, {
          success: false,
          error: "Old content not found in file",
          tier: 2,
          requiresApproval: false,
        });
      }

      await this.snapshotForWrite(resolved);
      const updated = current.replace(oldContent, newContent);
      await withTimeout(writeFile(resolved, updated, "utf-8"), OPERATION_TIMEOUT_MS, "edit-write");
      return tierResult(2, { success: true, tier: 2, requiresApproval: false });
    } catch (err) {
      return tierResult(2, {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        tier: 2,
        requiresApproval: false,
      });
    }
  }

  async mkdir(path: string): Promise<ConnectorResult> {
    this.ensureConnected();
    const resolved = this.resolveAndValidate(path);

    try {
      await withTimeout(mkdir(resolved, { recursive: true }), OPERATION_TIMEOUT_MS, "mkdir");
      return tierResult(2, { success: true, tier: 2, requiresApproval: false });
    } catch (err) {
      return tierResult(2, {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        tier: 2,
        requiresApproval: false,
      });
    }
  }

  async move(src: string, dest: string): Promise<ConnectorResult> {
    this.ensureConnected();
    const resolvedSrc = this.resolveAndValidate(src);
    const resolvedDest = this.resolveAndValidate(dest);

    try {
      await this.snapshotForWrite(resolvedSrc);
      await withTimeout(rename(resolvedSrc, resolvedDest), OPERATION_TIMEOUT_MS, "move");
      return tierResult(2, { success: true, tier: 2, requiresApproval: false });
    } catch (err) {
      return tierResult(2, {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        tier: 2,
        requiresApproval: false,
      });
    }
  }

  async copy(src: string, dest: string): Promise<ConnectorResult> {
    this.ensureConnected();
    const resolvedSrc = this.resolveAndValidate(src);
    const resolvedDest = this.resolveAndValidate(dest);

    try {
      await this.snapshotForWrite(resolvedDest);
      await withTimeout(copyFile(resolvedSrc, resolvedDest), OPERATION_TIMEOUT_MS, "copy");
      return tierResult(2, { success: true, tier: 2, requiresApproval: false });
    } catch (err) {
      return tierResult(2, {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        tier: 2,
        requiresApproval: false,
      });
    }
  }

  async delete(path: string): Promise<ConnectorResult> {
    this.ensureConnected();
    const resolved = this.resolveAndValidate(path);

    try {
      await withTimeout(unlink(resolved), OPERATION_TIMEOUT_MS, "delete");
      return tierResult(3, { success: true, tier: 3, requiresApproval: true });
    } catch (err) {
      return tierResult(3, {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        tier: 3,
        requiresApproval: true,
      });
    }
  }

  getScope(): ConnectorScope {
    return { ...this.scope };
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error(`Filesystem connector '${this.id}' is not connected`);
    }
  }

  private resolveAndValidate(path: string): string {
    const resolved = resolve(this.scope.basePath, path);

    if (hasTraversalEscape(path, this.scope.basePath)) {
      throw new Error(`Path traversal rejected: '${path}' escapes base path '${this.scope.basePath}'`);
    }

    if (this.scope.excludedPaths) {
      for (const excluded of this.scope.excludedPaths) {
        if (isWithinPath(resolved, excluded)) {
          throw new Error(`Path '${path}' is within excluded directory '${excluded}'`);
        }
      }
    }

    if (this.scope.allowedPaths && this.scope.allowedPaths.length > 0) {
      const allowed = this.scope.allowedPaths.some((ap) => isWithinPath(resolved, ap));
      if (!allowed) {
        throw new Error(`Path '${path}' is not within any allowed directory`);
      }
    }

    return resolved;
  }

  private async snapshotForWrite(filePath: string): Promise<void> {
    let content: Buffer;
    try {
      content = await readFile(filePath);
    } catch {
      content = Buffer.alloc(0);
    }

    await this.snapshotService.capturePreWrite(filePath, content, this.projectId);
  }
}

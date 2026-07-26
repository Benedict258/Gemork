import type { IConnector, ConnectorResult, ConnectorScope } from "./base-connector.js";
import { SnapshotService } from "../storage/snapshot-service.js";

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err) return String((err as { message: unknown }).message);
  return String(err);
}

export interface GoogleDriveConnectorConfig {
  apiKey?: string;
  serviceAccountKey?: string;
  folderId?: string;
  projectId: string;
  snapshotService?: SnapshotService;
}

const API_BASE = "https://www.googleapis.com/drive/v3";
const UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3";
const OPERATION_TIMEOUT_MS = 30_000;
const RATE_LIMIT_DELAY_MS = 200;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Operation '${label}' timed out after ${ms}ms`)), ms)
    ),
  ]);
}

function tierResult(tier: 1 | 2 | 3, result: ConnectorResult): ConnectorResult {
  return { ...result, tier };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class GoogleDriveConnector implements IConnector {
  readonly id = "google-drive";
  readonly name = "Google Drive";
  readonly type = "google-drive";

  private scope: ConnectorScope;
  private projectId: string;
  private snapshotService: SnapshotService;
  private apiKey?: string;
  private serviceAccountKey?: string;
  private connected = false;

  constructor(config: GoogleDriveConnectorConfig) {
    this.apiKey = config.apiKey;
    this.serviceAccountKey = config.serviceAccountKey;
    this.scope = {
      basePath: config.folderId ?? "root",
    };
    this.projectId = config.projectId;
    this.snapshotService = config.snapshotService ?? new SnapshotService();
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey || this.serviceAccountKey);
  }

  async connect(): Promise<void> {
    const available = await this.isAvailable();
    if (!available) {
      throw new Error(
        "Configure Google Drive API credentials — set GEMORK_GDRIVE_API_KEY or GEMORK_GDRIVE_SERVICE_ACCOUNT_KEY"
      );
    }
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  // ─── Tier 1: Read-only ───────────────────────────────────

  async read(fileId: string): Promise<ConnectorResult> {
    this.ensureConnected();
    try {
      const meta = await this.apiGet(`files/${fileId}?fields=mimeType,size,name`);
      if (String(meta.mimeType) === "application/vnd.google-apps.folder") {
        return tierResult(1, {
          success: false,
          error: "Cannot read content of a folder",
          tier: 1,
          requiresApproval: false,
        });
      }

      let url: string;
      if (String(meta.mimeType ?? "").startsWith("application/vnd.google-apps.")) {
        url = `files/${fileId}/export?mimeType=text/plain`;
      } else {
        url = `files/${fileId}?alt=media`;
      }

      const content = await this.apiGetRaw(url);
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

  async list(folderId?: string): Promise<ConnectorResult> {
    this.ensureConnected();
    const parent = folderId ?? this.scope.basePath;
    try {
      const q = `'${parent}' in trashed = false`;
      const data = await this.apiGet(
        `files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,size,modifiedTime)&pageSize=100`
      );
      return tierResult(1, {
        success: true,
        data: data.files ?? [],
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

  async stat(fileId: string): Promise<ConnectorResult> {
    this.ensureConnected();
    try {
      const data = await this.apiGet(
        `files/${fileId}?fields=id,name,mimeType,size,createdTime,modifiedTime,owners`
      );
      return tierResult(1, { success: true, data, tier: 1, requiresApproval: false });
    } catch (err) {
      return tierResult(1, {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        tier: 1,
        requiresApproval: false,
      });
    }
  }

  // ─── Tier 2: Reversible writes ──────────────────────────

  async write(path: string, content: string | Buffer): Promise<ConnectorResult> {
    this.ensureConnected();
    try {
      await this.snapshotForWrite(path);

      const metadata = {
        name: path.split("/").pop() ?? path,
        parents: [this.scope.basePath],
      };

      const boundary = "gemork_boundary";
      const body = this.buildMultipartBody(boundary, metadata, content);

      await sleep(RATE_LIMIT_DELAY_MS);
      const response = await fetch(
        `${UPLOAD_BASE}/files?uploadType=multipart`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": `multipart/related; boundary=${boundary}`,
          },
          body: new Uint8Array(body),
          signal: AbortSignal.timeout(OPERATION_TIMEOUT_MS),
        }
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        return tierResult(2, {
          success: false,
          error: `Google Drive API error ${response.status}: ${getErrorMessage(err) || response.statusText}`,
          tier: 2,
          requiresApproval: false,
        });
      }

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

  async edit(fileId: string, _oldContent: string, newContent: string): Promise<ConnectorResult> {
    this.ensureConnected();
    try {
      await this.snapshotForWrite(fileId);

      await sleep(RATE_LIMIT_DELAY_MS);
      const response = await fetch(
        `${UPLOAD_BASE}/files/${fileId}?uploadType=media`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/octet-stream",
          },
          body: typeof newContent === "string" ? Buffer.from(newContent) : newContent,
          signal: AbortSignal.timeout(OPERATION_TIMEOUT_MS),
        }
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        return tierResult(2, {
          success: false,
          error: `Google Drive API error ${response.status}: ${getErrorMessage(err) || response.statusText}`,
          tier: 2,
          requiresApproval: false,
        });
      }

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

  async mkdir(name: string): Promise<ConnectorResult> {
    this.ensureConnected();
    try {
      await sleep(RATE_LIMIT_DELAY_MS);
      const response = await withTimeout(
        fetch(`${API_BASE}/files`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name,
            mimeType: "application/vnd.google-apps.folder",
            parents: [this.scope.basePath],
          }),
          signal: AbortSignal.timeout(OPERATION_TIMEOUT_MS),
        }),
        OPERATION_TIMEOUT_MS,
        "mkdir"
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        return tierResult(2, {
          success: false,
          error: `Google Drive API error ${response.status}: ${getErrorMessage(err) || response.statusText}`,
          tier: 2,
          requiresApproval: false,
        });
      }

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

  async move(fileId: string, destFolderId: string): Promise<ConnectorResult> {
    this.ensureConnected();
    try {
      await this.snapshotForWrite(fileId);

      await sleep(RATE_LIMIT_DELAY_MS);
      const response = await withTimeout(
        fetch(
          `${API_BASE}/files/${fileId}?addParents=${destFolderId}&removeParents=${this.scope.basePath}&fields=id,parents`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
            },
            signal: AbortSignal.timeout(OPERATION_TIMEOUT_MS),
          }
        ),
        OPERATION_TIMEOUT_MS,
        "move"
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        return tierResult(2, {
          success: false,
          error: `Google Drive API error ${response.status}: ${getErrorMessage(err) || response.statusText}`,
          tier: 2,
          requiresApproval: false,
        });
      }

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

  async copy(fileId: string, destFolderId: string): Promise<ConnectorResult> {
    this.ensureConnected();
    try {
      await sleep(RATE_LIMIT_DELAY_MS);
      const response = await withTimeout(
        fetch(`${API_BASE}/files/${fileId}/copy`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ parents: [destFolderId] }),
          signal: AbortSignal.timeout(OPERATION_TIMEOUT_MS),
        }),
        OPERATION_TIMEOUT_MS,
        "copy"
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        return tierResult(2, {
          success: false,
          error: `Google Drive API error ${response.status}: ${getErrorMessage(err) || response.statusText}`,
          tier: 2,
          requiresApproval: false,
        });
      }

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

  // ─── Tier 3: Critical ───────────────────────────────────

  async delete(fileId: string): Promise<ConnectorResult> {
    this.ensureConnected();
    try {
      await sleep(RATE_LIMIT_DELAY_MS);
      const response = await withTimeout(
        fetch(`${API_BASE}/files/${fileId}?trashed=true`, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
          signal: AbortSignal.timeout(OPERATION_TIMEOUT_MS),
        }),
        OPERATION_TIMEOUT_MS,
        "delete"
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        return tierResult(3, {
          success: false,
          error: `Google Drive API error ${response.status}: ${getErrorMessage(err) || response.statusText}`,
          tier: 3,
          requiresApproval: true,
        });
      }

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

  // ─── Private helpers ────────────────────────────────────

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error(`Google Drive connector '${this.id}' is not connected`);
    }
  }

  private getAuthHeader(): string {
    return `Bearer ${this.apiKey}`;
  }

  private async apiGet(path: string): Promise<Record<string, unknown>> {
    await sleep(RATE_LIMIT_DELAY_MS);
    const response = await withTimeout(
      fetch(`${API_BASE}/${path}`, {
        headers: { Authorization: this.getAuthHeader() },
        signal: AbortSignal.timeout(OPERATION_TIMEOUT_MS),
      }),
      OPERATION_TIMEOUT_MS,
      "apiGet"
    );

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const msg = getErrorMessage((body as Record<string, unknown>).error) || response.statusText;
      if (response.status === 429) {
        throw new Error(`Google Drive rate limit exceeded: ${msg}`);
      }
      if (response.status === 404) {
        throw new Error(`File not found: ${msg}`);
      }
      throw new Error(`Google Drive API error ${response.status}: ${msg}`);
    }

    return response.json() as Promise<Record<string, unknown>>;
  }

  private async apiGetRaw(path: string): Promise<string> {
    await sleep(RATE_LIMIT_DELAY_MS);
    const response = await withTimeout(
      fetch(`${API_BASE}/${path}`, {
        headers: { Authorization: this.getAuthHeader() },
        signal: AbortSignal.timeout(OPERATION_TIMEOUT_MS),
      }),
      OPERATION_TIMEOUT_MS,
      "apiGetRaw"
    );

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const msg = getErrorMessage((body as Record<string, unknown>).error) || response.statusText;
      if (response.status === 429) {
        throw new Error(`Google Drive rate limit exceeded: ${msg}`);
      }
      if (response.status === 404) {
        throw new Error(`File not found: ${msg}`);
      }
      throw new Error(`Google Drive API error ${response.status}: ${msg}`);
    }

    return response.text();
  }

  private buildMultipartBody(
    boundary: string,
    metadata: Record<string, unknown>,
    content: string | Buffer
  ): Buffer {
    const metaJson = JSON.stringify(metadata);
    const contentBuf = typeof content === "string" ? Buffer.from(content) : content;
    const parts: Buffer[] = [];

    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metaJson}\r\n`
      )
    );
    parts.push(
      Buffer.from(`--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`)
    );
    parts.push(contentBuf);
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

    return Buffer.concat(parts);
  }

  private async snapshotForWrite(filePath: string): Promise<void> {
    await this.snapshotService.capturePreWrite(filePath, Buffer.alloc(0), this.projectId);
  }
}

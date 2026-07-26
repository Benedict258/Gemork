import type { IConnector, ConnectorResult, ConnectorScope } from "./base-connector.js";
import { SnapshotService } from "../storage/snapshot-service.js";

export interface NotionConnectorConfig {
  token: string;
  databaseId?: string;
  projectId: string;
  snapshotService?: SnapshotService;
}

const API_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const OPERATION_TIMEOUT_MS = 30_000;
const RATE_LIMIT_DELAY_MS = 350;

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

export class NotionConnector implements IConnector {
  readonly id = "notion";
  readonly name = "Notion";
  readonly type = "notion";

  private scope: ConnectorScope;
  private projectId: string;
  private snapshotService: SnapshotService;
  private token: string;
  private connected = false;

  constructor(config: NotionConnectorConfig) {
    this.token = config.token;
    this.scope = {
      basePath: config.databaseId ?? "default",
    };
    this.projectId = config.projectId;
    this.snapshotService = config.snapshotService ?? new SnapshotService();
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.token);
  }

  async connect(): Promise<void> {
    if (!this.token) {
      throw new Error("Configure Notion integration token — set GEMORK_NOTION_TOKEN");
    }
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  // ─── Tier 1: Read-only ───────────────────────────────────

  async read(pageId: string): Promise<ConnectorResult> {
    this.ensureConnected();
    try {
      const data = await this.apiGet(`blocks/${pageId}/children?page_size=100`);
      return tierResult(1, { success: true, data: data.results ?? [], tier: 1, requiresApproval: false });
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
    try {
      if (path) {
        const data = await this.apiGet(`databases/${path}`);
        return tierResult(1, { success: true, data, tier: 1, requiresApproval: false });
      }

      const data = await this.apiPost("search", {
        filter: { value: "database", property: "object" },
        page_size: 100,
      });
      return tierResult(1, {
        success: true,
        data: data.results ?? [],
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

  async stat(pageId: string): Promise<ConnectorResult> {
    this.ensureConnected();
    try {
      const data = await this.apiGet(`pages/${pageId}`);
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

  async queryDatabase(databaseId: string, filter?: Record<string, unknown>): Promise<ConnectorResult> {
    this.ensureConnected();
    try {
      const data = await this.apiPost(`databases/${databaseId}/query`, {
        filter: filter ?? {},
        page_size: 100,
      });
      return tierResult(1, {
        success: true,
        data: data.results ?? [],
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

  // ─── Tier 2: Reversible writes ──────────────────────────

  async write(path: string, content: string | Buffer): Promise<ConnectorResult> {
    this.ensureConnected();
    try {
      await this.snapshotForWrite(path);

      const title = typeof content === "string" ? content.slice(0, 200) : "Untitled";
      const data = await this.apiPost("pages", {
        parent: { database_id: this.scope.basePath },
        properties: {
          title: {
            title: [{ text: { content: title } }],
          },
        },
      });

      if (data.object === "error") {
        return tierResult(2, {
          success: false,
          error: `Notion API error: ${data.message}`,
          tier: 2,
          requiresApproval: false,
        });
      }

      return tierResult(2, { success: true, data: { pageId: data.id }, tier: 2, requiresApproval: false });
    } catch (err) {
      return tierResult(2, {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        tier: 2,
        requiresApproval: false,
      });
    }
  }

  async edit(pageId: string, _oldContent: string, newContent: string): Promise<ConnectorResult> {
    this.ensureConnected();
    try {
      await this.snapshotForWrite(pageId);

      const data = await this.apiPatch(`pages/${pageId}`, {
        properties: {
          title: {
            title: [{ text: { content: newContent.slice(0, 200) } }],
          },
        },
      });

      if (data.object === "error") {
        return tierResult(2, {
          success: false,
          error: `Notion API error: ${data.message}`,
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

  async mkdir(_name: string): Promise<ConnectorResult> {
    return tierResult(2, {
      success: false,
      error: "Notion connector does not support creating directories",
      tier: 2,
      requiresApproval: false,
    });
  }

  async move(_src: string, _dest: string): Promise<ConnectorResult> {
    return tierResult(2, {
      success: false,
      error: "Notion connector does not support moving pages between databases",
      tier: 2,
      requiresApproval: false,
    });
  }

  async copy(_src: string, _dest: string): Promise<ConnectorResult> {
    return tierResult(2, {
      success: false,
      error: "Notion connector does not support copying pages",
      tier: 2,
      requiresApproval: false,
    });
  }

  // ─── Tier 3: Critical ───────────────────────────────────

  async delete(pageId: string): Promise<ConnectorResult> {
    this.ensureConnected();
    try {
      const data = await this.apiPatch(`pages/${pageId}`, {
        archived: true,
      });

      if (data.object === "error") {
        return tierResult(3, {
          success: false,
          error: `Notion API error: ${data.message}`,
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
      throw new Error(`Notion connector '${this.id}' is not connected`);
    }
  }

  private async apiGet(path: string): Promise<Record<string, unknown>> {
    await sleep(RATE_LIMIT_DELAY_MS);
    const response = await withTimeout(
      fetch(`${API_BASE}/${path}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Notion-Version": NOTION_VERSION,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(OPERATION_TIMEOUT_MS),
      }),
      OPERATION_TIMEOUT_MS,
      `apiGet:${path}`
    );

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const msg = (body as Record<string, unknown>).message ?? response.statusText;
      if (response.status === 429) {
        throw new Error(`Notion rate limit exceeded: ${msg}`);
      }
      if (response.status === 404) {
        throw new Error(`Page not found: ${msg}`);
      }
      throw new Error(`Notion API error ${response.status}: ${msg}`);
    }

    return response.json() as Promise<Record<string, unknown>>;
  }

  private async apiPost(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    await sleep(RATE_LIMIT_DELAY_MS);
    const response = await withTimeout(
      fetch(`${API_BASE}/${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Notion-Version": NOTION_VERSION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(OPERATION_TIMEOUT_MS),
      }),
      OPERATION_TIMEOUT_MS,
      `apiPost:${path}`
    );

    if (!response.ok) {
      const respBody = await response.json().catch(() => ({}));
      const msg = (respBody as Record<string, unknown>).message ?? response.statusText;
      if (response.status === 429) {
        throw new Error(`Notion rate limit exceeded: ${msg}`);
      }
      throw new Error(`Notion API error ${response.status}: ${msg}`);
    }

    return response.json() as Promise<Record<string, unknown>>;
  }

  private async apiPatch(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    await sleep(RATE_LIMIT_DELAY_MS);
    const response = await withTimeout(
      fetch(`${API_BASE}/${path}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Notion-Version": NOTION_VERSION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(OPERATION_TIMEOUT_MS),
      }),
      OPERATION_TIMEOUT_MS,
      `apiPatch:${path}`
    );

    if (!response.ok) {
      const respBody = await response.json().catch(() => ({}));
      const msg = (respBody as Record<string, unknown>).message ?? response.statusText;
      if (response.status === 429) {
        throw new Error(`Notion rate limit exceeded: ${msg}`);
      }
      throw new Error(`Notion API error ${response.status}: ${msg}`);
    }

    return response.json() as Promise<Record<string, unknown>>;
  }

  private async snapshotForWrite(filePath: string): Promise<void> {
    await this.snapshotService.capturePreWrite(filePath, Buffer.alloc(0), this.projectId);
  }
}

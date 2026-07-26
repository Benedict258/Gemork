import type { IConnector, ConnectorResult, ConnectorScope } from "./base-connector.js";
import { SnapshotService } from "../storage/snapshot-service.js";

export interface SlackConnectorConfig {
  token: string;
  channels?: string[];
  projectId: string;
  snapshotService?: SnapshotService;
}

const API_BASE = "https://slack.com/api";
const OPERATION_TIMEOUT_MS = 30_000;
const RATE_LIMIT_DELAY_MS = 1100;

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

export class SlackConnector implements IConnector {
  readonly id = "slack";
  readonly name = "Slack";
  readonly type = "slack";

  private scope: ConnectorScope;
  private projectId: string;
  private snapshotService: SnapshotService;
  private token: string;
  private connected = false;

  constructor(config: SlackConnectorConfig) {
    this.token = config.token;
    this.scope = {
      basePath: "slack",
      allowedPaths: config.channels,
    };
    this.projectId = config.projectId;
    this.snapshotService = config.snapshotService ?? new SnapshotService();
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.token);
  }

  async connect(): Promise<void> {
    if (!this.token) {
      throw new Error("Configure Slack bot token — set GEMORK_SLACK_TOKEN");
    }

    const result = await this.apiPost("auth.test", {});
    if (!result.ok) {
      throw new Error(`Slack auth failed: ${result.error}`);
    }
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  // ─── Tier 1: Read-only ───────────────────────────────────

  async read(path: string): Promise<ConnectorResult> {
    this.ensureConnected();
    try {
      const channelId = path.replace(/^\//, "");
      const data = await this.apiPost("conversations.history", {
        channel: channelId,
        limit: 100,
      });

      if (!data.ok) {
        return tierResult(1, {
          success: false,
          error: `Slack API error: ${data.error}`,
          tier: 1,
          requiresApproval: false,
        });
      }

      return tierResult(1, {
        success: true,
        data: data.messages ?? [],
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

  async list(path?: string): Promise<ConnectorResult> {
    this.ensureConnected();
    try {
      if (path) {
        const channelId = path.replace(/^\//, "");
        const data = await this.apiPost("conversations.info", { channel: channelId });
        if (!data.ok) {
          return tierResult(1, {
            success: false,
            error: `Slack API error: ${data.error}`,
            tier: 1,
            requiresApproval: false,
          });
        }
        return tierResult(1, { success: true, data: data.channel, tier: 1, requiresApproval: false });
      }

      const data = await this.apiPost("conversations.list", { types: "public_channel,private_channel", limit: 200 });
      if (!data.ok) {
        return tierResult(1, {
          success: false,
          error: `Slack API error: ${data.error}`,
          tier: 1,
          requiresApproval: false,
        });
      }

      return tierResult(1, {
        success: true,
        data: data.channels ?? [],
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

  async stat(path: string): Promise<ConnectorResult> {
    this.ensureConnected();
    try {
      const channelId = path.replace(/^\//, "");
      const data = await this.apiPost("conversations.info", { channel: channelId });

      if (!data.ok) {
        return tierResult(1, {
          success: false,
          error: `Slack API error: ${data.error}`,
          tier: 1,
          requiresApproval: false,
        });
      }

      return tierResult(1, { success: true, data: data.channel, tier: 1, requiresApproval: false });
    } catch (err) {
      return tierResult(1, {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        tier: 1,
        requiresApproval: false,
      });
    }
  }

  async search(query: string): Promise<ConnectorResult> {
    this.ensureConnected();
    try {
      const data = await this.apiGet(`search.messages?query=${encodeURIComponent(query)}&count=20`);

      if (!data.ok) {
        return tierResult(1, {
          success: false,
          error: `Slack API error: ${data.error}`,
          tier: 1,
          requiresApproval: false,
        });
      }

      return tierResult(1, {
        success: true,
        data: data.messages ?? [],
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
    const channelId = path.replace(/^\//, "");
    const text = typeof content === "string" ? content : content.toString("utf-8");

    try {
      await this.snapshotForWrite(path);

      await sleep(RATE_LIMIT_DELAY_MS);
      const data = await this.apiPost("chat.postMessage", {
        channel: channelId,
        text,
      });

      if (!data.ok) {
        return tierResult(2, {
          success: false,
          error: `Slack API error: ${data.error}`,
          tier: 2,
          requiresApproval: false,
        });
      }

      return tierResult(2, {
        success: true,
        data: { ts: data.ts, channel: data.channel },
        tier: 2,
        requiresApproval: false,
      });
    } catch (err) {
      return tierResult(2, {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        tier: 2,
        requiresApproval: false,
      });
    }
  }

  async edit(path: string, _oldContent: string, newContent: string): Promise<ConnectorResult> {
    this.ensureConnected();
    const parts = path.split(":");
    const channelId = parts[0]?.replace(/^\//, "") ?? "";
    const ts = parts[1] ?? "";

    try {
      await this.snapshotForWrite(path);

      await sleep(RATE_LIMIT_DELAY_MS);
      const data = await this.apiPost("chat.update", {
        channel: channelId,
        ts,
        text: newContent,
      });

      if (!data.ok) {
        return tierResult(2, {
          success: false,
          error: `Slack API error: ${data.error}`,
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

  async mkdir(_path: string): Promise<ConnectorResult> {
    return tierResult(2, {
      success: false,
      error: "Slack connector does not support creating channels via mkdir",
      tier: 2,
      requiresApproval: false,
    });
  }

  async move(_src: string, _dest: string): Promise<ConnectorResult> {
    return tierResult(2, {
      success: false,
      error: "Slack connector does not support moving messages",
      tier: 2,
      requiresApproval: false,
    });
  }

  async copy(_src: string, _dest: string): Promise<ConnectorResult> {
    return tierResult(2, {
      success: false,
      error: "Slack connector does not support copying messages",
      tier: 2,
      requiresApproval: false,
    });
  }

  // ─── Tier 3: Critical ───────────────────────────────────

  async delete(path: string): Promise<ConnectorResult> {
    this.ensureConnected();
    const parts = path.split(":");
    const channelId = parts[0]?.replace(/^\//, "") ?? "";
    const ts = parts[1] ?? "";

    try {
      await sleep(RATE_LIMIT_DELAY_MS);
      const data = await this.apiPost("chat.delete", {
        channel: channelId,
        ts,
      });

      if (!data.ok) {
        return tierResult(3, {
          success: false,
          error: `Slack API error: ${data.error}`,
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
      throw new Error(`Slack connector '${this.id}' is not connected`);
    }
  }

  private async apiPost(endpoint: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    await sleep(RATE_LIMIT_DELAY_MS);
    const response = await withTimeout(
      fetch(`${API_BASE}/${endpoint}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(OPERATION_TIMEOUT_MS),
      }),
      OPERATION_TIMEOUT_MS,
      `apiPost:${endpoint}`
    );

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error("Slack rate limit exceeded");
      }
      throw new Error(`Slack API HTTP error ${response.status}`);
    }

    return response.json() as Promise<Record<string, unknown>>;
  }

  private async apiGet(path: string): Promise<Record<string, unknown>> {
    await sleep(RATE_LIMIT_DELAY_MS);
    const response = await withTimeout(
      fetch(`${API_BASE}/${path}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        signal: AbortSignal.timeout(OPERATION_TIMEOUT_MS),
      }),
      OPERATION_TIMEOUT_MS,
      `apiGet:${path}`
    );

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error("Slack rate limit exceeded");
      }
      throw new Error(`Slack API HTTP error ${response.status}`);
    }

    return response.json() as Promise<Record<string, unknown>>;
  }

  private async snapshotForWrite(filePath: string): Promise<void> {
    await this.snapshotService.capturePreWrite(filePath, Buffer.alloc(0), this.projectId);
  }
}

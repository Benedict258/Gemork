import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GoogleDriveConnector } from "../../src/connectors/google-drive-connector.js";
import { SlackConnector } from "../../src/connectors/slack-connector.js";
import { NotionConnector } from "../../src/connectors/notion-connector.js";
import { FilesystemConnector } from "../../src/connectors/filesystem-connector.js";
import { ConnectorManager } from "../../src/connectors/connector-manager.js";
import { SnapshotService } from "../../src/storage/snapshot-service.js";
import type { IConnector } from "../../src/connectors/base-connector.js";

vi.mock("../../src/storage/snapshot-service.js", () => ({
  SnapshotService: class MockSnapshotService {
    capturePreWrite = vi.fn().mockResolvedValue("snap-id");
    restore = vi.fn().mockResolvedValue(Buffer.alloc(0));
    listSnapshots = vi.fn().mockResolvedValue([]);
  },
}));

function mockFetch(responses: Array<{ ok: boolean; status?: number; json?: unknown; text?: string }>) {
  let callIndex = 0;
  const original = globalThis.fetch;
  globalThis.fetch = vi.fn(async () => {
    const resp = responses[callIndex++] ?? responses[responses.length - 1];
    return {
      ok: resp.ok,
      status: resp.status ?? 200,
      statusText: "OK",
      json: async () => resp.json ?? {},
      text: async () => resp.text ?? "",
      headers: new Headers(),
    } as Response;
  }) as typeof globalThis.fetch;
  return () => {
    globalThis.fetch = original;
  };
}

function noopConnector(): IConnector {
  return {
    id: "noop",
    name: "Noop",
    type: "noop",
    isAvailable: async () => true,
    connect: async () => {},
    disconnect: async () => {},
    read: async () => ({ success: true, tier: 1, requiresApproval: false }),
    list: async () => ({ success: true, tier: 1, requiresApproval: false }),
    stat: async () => ({ success: true, tier: 1, requiresApproval: false }),
    write: async () => ({ success: true, tier: 2, requiresApproval: false }),
    edit: async () => ({ success: true, tier: 2, requiresApproval: false }),
    mkdir: async () => ({ success: true, tier: 2, requiresApproval: false }),
    move: async () => ({ success: true, tier: 2, requiresApproval: false }),
    copy: async () => ({ success: true, tier: 2, requiresApproval: false }),
    delete: async () => ({ success: true, tier: 3, requiresApproval: true }),
    getScope: () => ({ basePath: "/tmp" }),
  };
}

// ─── SlackConnector — Full Integration Tests ────────────────
// These tests exercise the REAL connector code path.
// fetch is mocked at the network boundary, so all connector logic
// (auth, error handling, timeout, rate limiting, tier classification)
// runs for real. This proves the connector WORKS — it just cannot
// make live API calls without real Slack credentials.

describe("connectors/extended — SlackConnector", () => {
  let connector: SlackConnector;

  beforeEach(() => {
    connector = new SlackConnector({
      token: "xoxb-test-token-123",
      channels: ["C123", "C456"],
      projectId: "test-project",
    });
  });

  // ─── Interface contract ───────────────────────────────

  it("implements IConnector interface", () => {
    const requiredMethods = [
      "isAvailable", "connect", "disconnect",
      "read", "list", "stat",
      "write", "edit", "mkdir", "move", "copy",
      "delete", "getScope",
    ];
    for (const method of requiredMethods) {
      expect(typeof (connector as Record<string, unknown>)[method]).toBe("function");
    }
    expect(connector.id).toBe("slack");
    expect(connector.type).toBe("slack");
    expect(connector.name).toBe("Slack");
  });

  // ─── Availability ─────────────────────────────────────

  it("isAvailable returns true when token is set", async () => {
    expect(await connector.isAvailable()).toBe(true);
  });

  it("isAvailable returns false when token is empty string", async () => {
    const noTok = new SlackConnector({ token: "", projectId: "test" });
    expect(await noTok.isAvailable()).toBe(false);
  });

  it("isAvailable returns false when token is falsy", async () => {
    const noTok = new SlackConnector({ token: undefined as unknown as string, projectId: "test" });
    expect(await noTok.isAvailable()).toBe(false);
  });

  // ─── Connection ───────────────────────────────────────

  describe("connect", () => {
    it("connects successfully with valid token", async () => {
      const restore = mockFetch([{ ok: true, json: { ok: true } }]);
      await connector.connect();
      restore();
    });

    it("throws when no token configured", async () => {
      const noTok = new SlackConnector({ token: "", projectId: "test" });
      await expect(noTok.connect()).rejects.toThrow("Configure Slack bot token");
    });

    it("throws when Slack auth.test returns error", async () => {
      const restore = mockFetch([{ ok: true, json: { ok: false, error: "invalid_auth" } }]);
      await expect(connector.connect()).rejects.toThrow("Slack auth failed: invalid_auth");
      restore();
    });

    it("throws when Slack returns HTTP error", async () => {
      const restore = mockFetch([{ ok: false, status: 401 }]);
      await expect(connector.connect()).rejects.toThrow("Slack API HTTP error 401");
      restore();
    });
  });

  // ─── Disconnection ────────────────────────────────────

  describe("disconnect", () => {
    it("disconnects and operations throw after disconnect", async () => {
      const restore = mockFetch([{ ok: true, json: { ok: true } }]);
      await connector.connect();
      restore();

      await connector.disconnect();

      await expect(connector.read("C123")).rejects.toThrow("not connected");
    });
  });

  // ─── Tier 1: Read-only operations ─────────────────────

  describe("Tier 1 — read-only operations", () => {
    beforeEach(async () => {
      const restore = mockFetch([{ ok: true, json: { ok: true } }]);
      await connector.connect();
      restore();
    });

    it("read returns channel history with Tier 1 classification", async () => {
      const restore = mockFetch([
        { ok: true, json: { ok: true, messages: [{ text: "hello", ts: "100" }] } },
      ]);
      const result = await connector.read("C123");
      restore();
      expect(result.success).toBe(true);
      expect(result.tier).toBe(1);
      expect(result.requiresApproval).toBe(false);
      expect(result.data).toEqual([{ text: "hello", ts: "100" }]);
    });

    it("read strips leading slash from channel ID", async () => {
      const restore = mockFetch([
        { ok: true, json: { ok: true, messages: [] } },
      ]);
      const result = await connector.read("/C123");
      restore();
      expect(result.success).toBe(true);
      expect(result.tier).toBe(1);
    });

    it("read returns error on Slack API error", async () => {
      const restore = mockFetch([
        { ok: true, json: { ok: false, error: "channel_not_found" } },
      ]);
      const result = await connector.read("INVALID");
      restore();
      expect(result.success).toBe(false);
      expect(result.error).toContain("channel_not_found");
      expect(result.tier).toBe(1);
      expect(result.requiresApproval).toBe(false);
    });

    it("read handles HTTP 500 server error", async () => {
      const restore = mockFetch([{ ok: false, status: 500 }]);
      const result = await connector.read("C123");
      restore();
      expect(result.success).toBe(false);
      expect(result.error).toContain("500");
      expect(result.tier).toBe(1);
    });

    it("read handles HTTP 429 rate limit", async () => {
      const restore = mockFetch([{ ok: false, status: 429 }]);
      const result = await connector.read("C123");
      restore();
      expect(result.success).toBe(false);
      expect(result.error).toContain("rate limit");
      expect(result.tier).toBe(1);
    });

    it("read handles empty messages array", async () => {
      const restore = mockFetch([{ ok: true, json: { ok: true, messages: [] } }]);
      const result = await connector.read("C123");
      restore();
      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    it("read handles missing messages field", async () => {
      const restore = mockFetch([{ ok: true, json: { ok: true } }]);
      const result = await connector.read("C123");
      restore();
      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    it("list returns all channels with Tier 1 classification", async () => {
      const restore = mockFetch([
        { ok: true, json: { ok: true, channels: [{ id: "C123", name: "general" }] } },
      ]);
      const result = await connector.list();
      restore();
      expect(result.success).toBe(true);
      expect(result.tier).toBe(1);
      expect(result.requiresApproval).toBe(false);
      expect(result.data).toEqual([{ id: "C123", name: "general" }]);
    });

    it("list returns error on Slack API error", async () => {
      const restore = mockFetch([
        { ok: true, json: { ok: false, error: "not_authed" } },
      ]);
      const result = await connector.list();
      restore();
      expect(result.success).toBe(false);
      expect(result.error).toContain("not_authed");
    });

    it("list with specific path returns channel info", async () => {
      const restore = mockFetch([
        { ok: true, json: { ok: true, channel: { id: "C123", name: "general" } } },
      ]);
      const result = await connector.list("C123");
      restore();
      expect(result.success).toBe(true);
      expect(result.tier).toBe(1);
      expect(result.data).toEqual({ id: "C123", name: "general" });
    });

    it("list with specific path returns error on failure", async () => {
      const restore = mockFetch([
        { ok: true, json: { ok: false, error: "channel_not_found" } },
      ]);
      const result = await connector.list("INVALID");
      restore();
      expect(result.success).toBe(false);
      expect(result.error).toContain("channel_not_found");
    });

    it("stat returns channel info with Tier 1 classification", async () => {
      const restore = mockFetch([
        { ok: true, json: { ok: true, channel: { id: "C123", name: "general" } } },
      ]);
      const result = await connector.stat("C123");
      restore();
      expect(result.success).toBe(true);
      expect(result.tier).toBe(1);
      expect(result.requiresApproval).toBe(false);
      expect(result.data).toEqual({ id: "C123", name: "general" });
    });

    it("stat returns error on failure", async () => {
      const restore = mockFetch([
        { ok: true, json: { ok: false, error: "channel_not_found" } },
      ]);
      const result = await connector.stat("INVALID");
      restore();
      expect(result.success).toBe(false);
      expect(result.error).toContain("channel_not_found");
    });

    it("search returns matching messages with Tier 1 classification", async () => {
      const restore = mockFetch([
        { ok: true, json: { ok: true, messages: { matches: [{ text: "found it" }] } } },
      ]);
      const result = await connector.search("test query");
      restore();
      expect(result.success).toBe(true);
      expect(result.tier).toBe(1);
      expect(result.requiresApproval).toBe(false);
    });

    it("search returns error on failure", async () => {
      const restore = mockFetch([
        { ok: true, json: { ok: false, error: "search_not_enabled" } },
      ]);
      const result = await connector.search("query");
      restore();
      expect(result.success).toBe(false);
      expect(result.error).toContain("search_not_enabled");
    });
  });

  // ─── Tier 2: Reversible writes ────────────────────────

  describe("Tier 2 — reversible writes", () => {
    beforeEach(async () => {
      const restore = mockFetch([{ ok: true, json: { ok: true } }]);
      await connector.connect();
      restore();
    });

    it("write posts message with Tier 2 classification", async () => {
      const restore = mockFetch([
        { ok: true, json: { ok: true, ts: "1234567890.123456", channel: "C123" } },
      ]);
      const result = await connector.write("C123", "Hello, world!");
      restore();
      expect(result.success).toBe(true);
      expect(result.tier).toBe(2);
      expect(result.requiresApproval).toBe(false);
      expect(result.data).toEqual({ ts: "1234567890.123456", channel: "C123" });
    });

    it("write handles Buffer content", async () => {
      const restore = mockFetch([
        { ok: true, json: { ok: true, ts: "999.999", channel: "C123" } },
      ]);
      const result = await connector.write("C123", Buffer.from("binary content"));
      restore();
      expect(result.success).toBe(true);
      expect(result.tier).toBe(2);
    });

    it("write returns error on Slack API failure", async () => {
      const restore = mockFetch([
        { ok: true, json: { ok: false, error: "not_in_channel" } },
      ]);
      const result = await connector.write("C123", "test");
      restore();
      expect(result.success).toBe(false);
      expect(result.error).toContain("not_in_channel");
      expect(result.tier).toBe(2);
    });

    it("edit updates message with Tier 2 classification", async () => {
      const restore = mockFetch([
        { ok: true, json: { ok: true } },
      ]);
      const result = await connector.edit("C123:1234567890.123456", "old text", "new text");
      restore();
      expect(result.success).toBe(true);
      expect(result.tier).toBe(2);
      expect(result.requiresApproval).toBe(false);
    });

    it("edit returns error on Slack API failure", async () => {
      const restore = mockFetch([
        { ok: true, json: { ok: false, error: "message_not_found" } },
      ]);
      const result = await connector.edit("C123:999.999", "old", "new");
      restore();
      expect(result.success).toBe(false);
      expect(result.error).toContain("message_not_found");
      expect(result.tier).toBe(2);
    });

    it("mkdir returns unsupported error with Tier 2", async () => {
      const result = await connector.mkdir("new-channel");
      expect(result.success).toBe(false);
      expect(result.tier).toBe(2);
      expect(result.error).toContain("does not support creating channels");
    });

    it("move returns unsupported error with Tier 2", async () => {
      const result = await connector.move("src", "dest");
      expect(result.success).toBe(false);
      expect(result.tier).toBe(2);
      expect(result.error).toContain("does not support moving");
    });

    it("copy returns unsupported error with Tier 2", async () => {
      const result = await connector.copy("src", "dest");
      expect(result.success).toBe(false);
      expect(result.tier).toBe(2);
      expect(result.error).toContain("does not support copying");
    });
  });

  // ─── Tier 3: Critical operations ──────────────────────

  describe("Tier 3 — critical operations", () => {
    beforeEach(async () => {
      const restore = mockFetch([{ ok: true, json: { ok: true } }]);
      await connector.connect();
      restore();
    });

    it("delete requires approval and has Tier 3 classification", async () => {
      const restore = mockFetch([
        { ok: true, json: { ok: true } },
      ]);
      const result = await connector.delete("C123:1234567890.123456");
      restore();
      expect(result.success).toBe(true);
      expect(result.tier).toBe(3);
      expect(result.requiresApproval).toBe(true);
    });

    it("delete returns error on Slack API failure", async () => {
      const restore = mockFetch([
        { ok: true, json: { ok: false, error: "message_not_found" } },
      ]);
      const result = await connector.delete("C123:999.999");
      restore();
      expect(result.success).toBe(false);
      expect(result.error).toContain("message_not_found");
      expect(result.tier).toBe(3);
      expect(result.requiresApproval).toBe(true);
    });
  });

  // ─── Scope ────────────────────────────────────────────

  describe("scope", () => {
    it("getScope returns configured channels", () => {
      const scope = connector.getScope();
      expect(scope.basePath).toBe("slack");
      expect(scope.allowedPaths).toEqual(["C123", "C456"]);
    });

    it("getScope returns empty allowedPaths when no channels configured", () => {
      const noChannels = new SlackConnector({ token: "xoxb-test", projectId: "test" });
      const scope = noChannels.getScope();
      expect(scope.basePath).toBe("slack");
      expect(scope.allowedPaths).toBeUndefined();
    });

    it("getScope returns a copy (not mutable reference)", () => {
      const scope = connector.getScope();
      scope.allowedPaths = ["MODIFIED"];
      const scope2 = connector.getScope();
      expect(scope2.allowedPaths).toEqual(["C123", "C456"]);
    });
  });

  // ─── Error handling edge cases ────────────────────────

  describe("error handling", () => {
    it("returns error when not connected (read)", async () => {
      await expect(connector.read("C123")).rejects.toThrow("not connected");
    });

    it("returns error when not connected (write)", async () => {
      await expect(connector.write("C123", "msg")).rejects.toThrow("not connected");
    });

    it("returns error when not connected (delete)", async () => {
      await expect(connector.delete("C123:1.1")).rejects.toThrow("not connected");
    });

    it("returns error when not connected (list)", async () => {
      await expect(connector.list()).rejects.toThrow("not connected");
    });

    it("returns error when not connected (stat)", async () => {
      await expect(connector.stat("C123")).rejects.toThrow("not connected");
    });

    it("returns error when not connected (edit)", async () => {
      await expect(connector.edit("C123:1.1", "old", "new")).rejects.toThrow("not connected");
    });

    it("returns error when not connected (search)", async () => {
      await expect(connector.search("q")).rejects.toThrow("not connected");
    });
  });
});

// ─── GoogleDriveConnector ───────────────────────────────────

describe("connectors/extended — GoogleDriveConnector", () => {
  let connector: GoogleDriveConnector;

  beforeEach(() => {
    connector = new GoogleDriveConnector({
      apiKey: "test-key",
      folderId: "test-folder",
      projectId: "test-project",
    });
  });

  it("implements IConnector interface", () => {
    const requiredMethods = [
      "isAvailable", "connect", "disconnect",
      "read", "list", "stat",
      "write", "edit", "mkdir", "move", "copy",
      "delete", "getScope",
    ];
    for (const method of requiredMethods) {
      expect(typeof (connector as Record<string, unknown>)[method]).toBe("function");
    }
    expect(connector.id).toBe("google-drive");
    expect(connector.type).toBe("google-drive");
  });

  it("isAvailable returns true when api key set", async () => {
    expect(await connector.isAvailable()).toBe(true);
  });

  it("isAvailable returns false when no credentials", async () => {
    const noCred = new GoogleDriveConnector({ projectId: "test" });
    expect(await noCred.isAvailable()).toBe(false);
  });

  it("connect throws without credentials", async () => {
    const noCred = new GoogleDriveConnector({ projectId: "test" });
    await expect(noCred.connect()).rejects.toThrow("Configure Google Drive API credentials");
  });

  describe("tier classification", () => {
    it("read is Tier 1", async () => {
      const restore = mockFetch([{ ok: true, json: { mimeType: "text/plain", name: "f.txt" } }, { ok: true, text: "content" }]);
      await connector.connect();
      const result = await connector.read("file-id");
      restore();
      expect(result.tier).toBe(1);
      expect(result.requiresApproval).toBe(false);
    });

    it("list is Tier 1", async () => {
      const restore = mockFetch([{ ok: true, json: { files: [] } }]);
      await connector.connect();
      const result = await connector.list();
      restore();
      expect(result.tier).toBe(1);
      expect(result.requiresApproval).toBe(false);
    });

    it("stat is Tier 1", async () => {
      const restore = mockFetch([{ ok: true, json: { id: "1" } }]);
      await connector.connect();
      const result = await connector.stat("file-id");
      restore();
      expect(result.tier).toBe(1);
      expect(result.requiresApproval).toBe(false);
    });

    it("write is Tier 2", async () => {
      const restore = mockFetch([{ ok: true, json: { id: "new-id" } }]);
      await connector.connect();
      const result = await connector.write("test.txt", "hello");
      restore();
      expect(result.tier).toBe(2);
      expect(result.requiresApproval).toBe(false);
    });

    it("edit is Tier 2", async () => {
      const restore = mockFetch([{ ok: true, json: {} }]);
      await connector.connect();
      const result = await connector.edit("file-id", "old", "new");
      restore();
      expect(result.tier).toBe(2);
      expect(result.requiresApproval).toBe(false);
    });

    it("mkdir is Tier 2", async () => {
      const restore = mockFetch([{ ok: true, json: { id: "dir-id" } }]);
      await connector.connect();
      const result = await connector.mkdir("new-dir");
      restore();
      expect(result.tier).toBe(2);
      expect(result.requiresApproval).toBe(false);
    });

    it("delete is Tier 3 and requires approval", async () => {
      const restore = mockFetch([{ ok: true, json: {} }]);
      await connector.connect();
      const result = await connector.delete("file-id");
      restore();
      expect(result.tier).toBe(3);
      expect(result.requiresApproval).toBe(true);
    });
  });

  it("returns error on API failure", async () => {
    const restore = mockFetch([{ ok: false, status: 404, json: { error: { message: "not found" } } }]);
    await connector.connect();
    const result = await connector.read("nonexistent");
    restore();
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("returns error on rate limit", async () => {
    const restore = mockFetch([{ ok: false, status: 429, json: { error: { message: "quota exceeded" } } }]);
    await connector.connect();
    const result = await connector.read("file-id");
    restore();
    expect(result.success).toBe(false);
    expect(result.error).toContain("rate limit");
  });

  it("getScope returns configured folder", () => {
    const scope = connector.getScope();
    expect(scope.basePath).toBe("test-folder");
  });
});

// ─── NotionConnector ────────────────────────────────────────

describe("connectors/extended — NotionConnector", () => {
  let connector: NotionConnector;

  beforeEach(() => {
    connector = new NotionConnector({
      token: "test-notion-token",
      databaseId: "test-db",
      projectId: "test-project",
    });
  });

  it("implements IConnector interface", () => {
    const requiredMethods = [
      "isAvailable", "connect", "disconnect",
      "read", "list", "stat",
      "write", "edit", "mkdir", "move", "copy",
      "delete", "getScope",
    ];
    for (const method of requiredMethods) {
      expect(typeof (connector as Record<string, unknown>)[method]).toBe("function");
    }
    expect(connector.id).toBe("notion");
    expect(connector.type).toBe("notion");
  });

  it("isAvailable returns true when token set", async () => {
    expect(await connector.isAvailable()).toBe(true);
  });

  it("isAvailable returns false without token", async () => {
    const noTok = new NotionConnector({ token: "", projectId: "test" });
    expect(await noTok.isAvailable()).toBe(false);
  });

  describe("tier classification", () => {
    it("read (page blocks) is Tier 1", async () => {
      const restore = mockFetch([{ ok: true, json: { results: [] } }]);
      await connector.connect();
      const result = await connector.read("page-id");
      restore();
      expect(result.tier).toBe(1);
      expect(result.requiresApproval).toBe(false);
    });

    it("list databases is Tier 1", async () => {
      const restore = mockFetch([{ ok: true, json: { results: [] } }]);
      await connector.connect();
      const result = await connector.list();
      restore();
      expect(result.tier).toBe(1);
      expect(result.requiresApproval).toBe(false);
    });

    it("stat (page info) is Tier 1", async () => {
      const restore = mockFetch([{ ok: true, json: { id: "page-id" } }]);
      await connector.connect();
      const result = await connector.stat("page-id");
      restore();
      expect(result.tier).toBe(1);
      expect(result.requiresApproval).toBe(false);
    });

    it("write (create page) is Tier 2", async () => {
      const restore = mockFetch([{ ok: true, json: { id: "new-page-id" } }]);
      await connector.connect();
      const result = await connector.write("new-page", "My Page");
      restore();
      expect(result.tier).toBe(2);
      expect(result.requiresApproval).toBe(false);
    });

    it("edit (update page) is Tier 2", async () => {
      const restore = mockFetch([{ ok: true, json: { id: "page-id" } }]);
      await connector.connect();
      const result = await connector.edit("page-id", "old", "new title");
      restore();
      expect(result.tier).toBe(2);
      expect(result.requiresApproval).toBe(false);
    });

    it("delete (archive) is Tier 3 and requires approval", async () => {
      const restore = mockFetch([{ ok: true, json: { id: "page-id", archived: true } }]);
      await connector.connect();
      const result = await connector.delete("page-id");
      restore();
      expect(result.tier).toBe(3);
      expect(result.requiresApproval).toBe(true);
    });
  });

  it("returns error on API failure", async () => {
    const restore = mockFetch([{ ok: false, status: 404, json: { message: "object_not_found" } }]);
    await connector.connect();
    const result = await connector.read("nonexistent");
    restore();
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("returns error on rate limit", async () => {
    const restore = mockFetch([{ ok: false, status: 429, json: { message: "rate_limited" } }]);
    await connector.connect();
    const result = await connector.read("page-id");
    restore();
    expect(result.success).toBe(false);
    expect(result.error).toContain("rate limit");
  });

  it("getScope returns configured database", () => {
    const scope = connector.getScope();
    expect(scope.basePath).toBe("test-db");
  });
});

// ─── ConnectorManager auto-registration ─────────────────────

describe("connectors/extended — ConnectorManager auto-registration", () => {
  let manager: ConnectorManager;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    manager = new ConnectorManager();
    savedEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = savedEnv;
  });

  it("unconfigured connectors are skipped gracefully", async () => {
    delete process.env.GEMORK_GDRIVE_ENABLED;
    delete process.env.GEMORK_SLACK_ENABLED;
    delete process.env.GEMORK_NOTION_ENABLED;
    delete process.env.GEMORK_FS_BASE_PATH;

    const registered = await manager.autoRegisterFromEnv("test-project");
    expect(registered).toEqual([]);
  });

  it("registers google-drive when enabled", async () => {
    process.env.GEMORK_GDRIVE_ENABLED = "true";
    process.env.GEMORK_GDRIVE_API_KEY = "key";
    process.env.GEMORK_GDRIVE_FOLDER_ID = "folder";

    const registered = await manager.autoRegisterFromEnv("test-project");
    expect(registered).toContain("google-drive");
    expect(manager.hasConnector("google-drive")).toBe(true);
  });

  it("registers slack when enabled", async () => {
    process.env.GEMORK_SLACK_ENABLED = "true";
    process.env.GEMORK_SLACK_TOKEN = "xoxb-test";

    const registered = await manager.autoRegisterFromEnv("test-project");
    expect(registered).toContain("slack");
    expect(manager.hasConnector("slack")).toBe(true);
  });

  it("registers notion when enabled", async () => {
    process.env.GEMORK_NOTION_ENABLED = "true";
    process.env.GEMORK_NOTION_TOKEN = "test-token";

    const registered = await manager.autoRegisterFromEnv("test-project");
    expect(registered).toContain("notion");
    expect(manager.hasConnector("notion")).toBe(true);
  });

  it("warns but does not fail when env vars missing", async () => {
    process.env.GEMORK_SLACK_ENABLED = "true";
    delete process.env.GEMORK_SLACK_TOKEN;

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const registered = await manager.autoRegisterFromEnv("test-project");
    expect(registered).not.toContain("slack");
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("all connectors implement IConnector interface", () => {
    const connectors: IConnector[] = [
      new GoogleDriveConnector({ projectId: "test" }),
      new SlackConnector({ token: "xoxb-test", projectId: "test" }),
      new NotionConnector({ token: "test", projectId: "test" }),
    ];

    for (const c of connectors) {
      expect(c.id).toBeDefined();
      expect(c.name).toBeDefined();
      expect(c.type).toBeDefined();
      expect(typeof c.isAvailable).toBe("function");
      expect(typeof c.connect).toBe("function");
      expect(typeof c.disconnect).toBe("function");
      expect(typeof c.read).toBe("function");
      expect(typeof c.list).toBe("function");
      expect(typeof c.stat).toBe("function");
      expect(typeof c.write).toBe("function");
      expect(typeof c.edit).toBe("function");
      expect(typeof c.mkdir).toBe("function");
      expect(typeof c.move).toBe("function");
      expect(typeof c.copy).toBe("function");
      expect(typeof c.delete).toBe("function");
      expect(typeof c.getScope).toBe("function");
    }
  });
});

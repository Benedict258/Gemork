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

describe("connectors/extended — SlackConnector", () => {
  let connector: SlackConnector;

  beforeEach(() => {
    connector = new SlackConnector({
      token: "xoxb-test",
      channels: ["C123"],
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
    expect(connector.id).toBe("slack");
    expect(connector.type).toBe("slack");
  });

  it("isAvailable returns true when token set", async () => {
    expect(await connector.isAvailable()).toBe(true);
  });

  it("isAvailable returns false without token", async () => {
    const noTok = new SlackConnector({ token: "", projectId: "test" });
    expect(await noTok.isAvailable()).toBe(false);
  });

  describe("tier classification", () => {
    it("read (channel history) is Tier 1", async () => {
      const restore = mockFetch([{ ok: true, json: { ok: true, messages: [] } }]);
      await connector.connect();
      const result = await connector.read("C123");
      restore();
      expect(result.tier).toBe(1);
      expect(result.requiresApproval).toBe(false);
    });

    it("list channels is Tier 1", async () => {
      const restore = mockFetch([{ ok: true, json: { ok: true, channels: [] } }]);
      await connector.connect();
      const result = await connector.list();
      restore();
      expect(result.tier).toBe(1);
      expect(result.requiresApproval).toBe(false);
    });

    it("stat (channel info) is Tier 1", async () => {
      const restore = mockFetch([{ ok: true, json: { ok: true, channel: {} } }]);
      await connector.connect();
      const result = await connector.stat("C123");
      restore();
      expect(result.tier).toBe(1);
      expect(result.requiresApproval).toBe(false);
    });

    it("write (post message) is Tier 2", async () => {
      const restore = mockFetch([{ ok: true, json: { ok: true, ts: "123.456", channel: "C123" } }]);
      await connector.connect();
      const result = await connector.write("C123", "Hello");
      restore();
      expect(result.tier).toBe(2);
      expect(result.requiresApproval).toBe(false);
    });

    it("edit (update message) is Tier 2", async () => {
      const restore = mockFetch([{ ok: true, json: { ok: true } }]);
      await connector.connect();
      const result = await connector.edit("C123:123.456", "old", "new");
      restore();
      expect(result.tier).toBe(2);
      expect(result.requiresApproval).toBe(false);
    });

    it("delete is Tier 3 and requires approval", async () => {
      const restore = mockFetch([{ ok: true, json: { ok: true } }]);
      await connector.connect();
      const result = await connector.delete("C123:123.456");
      restore();
      expect(result.tier).toBe(3);
      expect(result.requiresApproval).toBe(true);
    });
  });

  it("returns error on API failure", async () => {
    const restore = mockFetch([
      { ok: true, json: { ok: true } },
      { ok: true, json: { ok: false, error: "channel_not_found" } },
    ]);
    await connector.connect();
    const result = await connector.read("INVALID");
    restore();
    expect(result.success).toBe(false);
    expect(result.error).toContain("channel_not_found");
  });

  it("getScope includes configured channels", () => {
    const scope = connector.getScope();
    expect(scope.allowedPaths).toEqual(["C123"]);
  });
});

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

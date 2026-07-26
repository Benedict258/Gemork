import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FilesystemConnector } from "../../src/connectors/filesystem-connector.js";
import { ConnectorManager } from "../../src/connectors/connector-manager.js";
import { SnapshotService } from "../../src/storage/snapshot-service.js";
import { createTestProject, createTestFile, cleanupTestArtifacts, type TestProject } from "../setup.js";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";

describe("connectors/filesystem-connector", () => {
  let project: TestProject;
  let connector: FilesystemConnector;
  let snapshotService: SnapshotService;

  beforeEach(async () => {
    project = await createTestProject("connector");
    snapshotService = new SnapshotService();
    connector = new FilesystemConnector({
      basePath: project.dir,
      projectId: "test-project",
      snapshotService,
    });
    await connector.connect();
  });

  afterEach(async () => {
    await connector.disconnect();
    await cleanupTestArtifacts(project.dir);
    await project.cleanup();
  });

  describe("read", () => {
    it("returns file content for Tier 1 read", async () => {
      await createTestFile(project, "hello.txt", "Hello, Gemork!");
      const result = await connector.read("hello.txt");

      expect(result.success).toBe(true);
      expect(result.tier).toBe(1);
      expect(result.requiresApproval).toBe(false);
      expect(Buffer.isBuffer(result.data)).toBe(true);
      expect(result.data!.toString()).toBe("Hello, Gemork!");
    });

    it("returns error for nonexistent file", async () => {
      const result = await connector.read("nonexistent.txt");
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });

  describe("write", () => {
    it("creates snapshot first then writes (Tier 2)", async () => {
      await createTestFile(project, "existing.txt", "old content");
      const result = await connector.write("existing.txt", "new content");

      expect(result.success).toBe(true);
      expect(result.tier).toBe(2);
      expect(result.requiresApproval).toBe(false);

      // Verify file was written
      const content = await readFile(join(project.dir, "existing.txt"), "utf-8");
      expect(content).toBe("new content");

      // Verify snapshot exists
      const snapshots = await snapshotService.listSnapshots("test-project");
      expect(snapshots.length).toBeGreaterThanOrEqual(1);
    });

    it("writes new file (Tier 2)", async () => {
      const result = await connector.write("new-file.txt", "created content");
      expect(result.success).toBe(true);
      expect(result.tier).toBe(2);

      const content = await readFile(join(project.dir, "new-file.txt"), "utf-8");
      expect(content).toBe("created content");
    });
  });

  describe("delete", () => {
    it("requires approval (Tier 3)", async () => {
      const result = await connector.delete("some-file.txt");
      expect(result.tier).toBe(3);
      expect(result.requiresApproval).toBe(true);
    });
  });

  describe("path traversal prevention", () => {
    it("rejects paths with .. escaping base", async () => {
      await expect(connector.read("../../etc/passwd")).rejects.toThrow("traversal");
    });

    it("rejects absolute paths outside scope", async () => {
      await expect(connector.read("/etc/passwd")).rejects.toThrow("traversal");
    });
  });

  describe("list", () => {
    it("lists directory contents (Tier 1)", async () => {
      await createTestFile(project, "a.txt", "a");
      await createTestFile(project, "b.txt", "b");
      await createTestFile(project, "sub/c.txt", "c");

      const result = await connector.list();
      expect(result.success).toBe(true);
      expect(result.tier).toBe(1);
      const items = result.data as Array<{ name: string; isFile: boolean }>;
      expect(items.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("stat", () => {
    it("returns file metadata (Tier 1)", async () => {
      await createTestFile(project, "info.txt", "test content");
      const result = await connector.stat("info.txt");

      expect(result.success).toBe(true);
      expect(result.tier).toBe(1);
      const info = result.data as { isFile: boolean; size: number };
      expect(info.isFile).toBe(true);
      expect(info.size).toBeGreaterThan(0);
    });
  });

  describe("not connected", () => {
    it("throws when not connected", async () => {
      const disconnected = new FilesystemConnector({
        basePath: project.dir,
        projectId: "test",
        snapshotService: new SnapshotService(),
      });

      await expect(disconnected.read("file.txt")).rejects.toThrow("not connected");
    });
  });

  describe("scope", () => {
    it("returns scope with basePath", () => {
      const scope = connector.getScope();
      expect(scope.basePath).toBe(project.dir);
    });
  });
});

describe("connectors/connector-manager", () => {
  let project: TestProject;
  let manager: ConnectorManager;

  beforeEach(async () => {
    project = await createTestProject("manager");
    manager = new ConnectorManager();
  });

  afterEach(async () => {
    await cleanupTestArtifacts(project.dir);
    await project.cleanup();
  });

  it("registers and retrieves connectors", () => {
    const connector = new FilesystemConnector({
      basePath: project.dir,
      projectId: "test",
      snapshotService: new SnapshotService(),
    });

    manager.registerConnector(connector);
    expect(manager.getConnector(connector.id)).toBe(connector);
    expect(manager.listConnectors()).toHaveLength(1);
  });

  it("rejects duplicate registration", () => {
    const connector = new FilesystemConnector({
      basePath: project.dir,
      projectId: "test",
      snapshotService: new SnapshotService(),
    });

    manager.registerConnector(connector);
    expect(() => manager.registerConnector(connector)).toThrow("already registered");
  });

  it("first-use approval flow", () => {
    const connector = new FilesystemConnector({
      basePath: project.dir,
      projectId: "test",
      snapshotService: new SnapshotService(),
    });

    manager.registerConnector(connector);
    expect(manager.isConnectorApproved(connector.id)).toBe(false);

    manager.approveConnector(connector.id);
    expect(manager.isConnectorApproved(connector.id)).toBe(true);
  });

  it("resetSessionApprovals clears approvals", () => {
    const connector = new FilesystemConnector({
      basePath: project.dir,
      projectId: "test",
      snapshotService: new SnapshotService(),
    });

    manager.registerConnector(connector);
    manager.approveConnector(connector.id);
    expect(manager.isConnectorApproved(connector.id)).toBe(true);

    manager.resetSessionApprovals();
    expect(manager.isConnectorApproved(connector.id)).toBe(false);
  });

  it("unregisterConnector removes connector", () => {
    const connector = new FilesystemConnector({
      basePath: project.dir,
      projectId: "test",
      snapshotService: new SnapshotService(),
    });

    manager.registerConnector(connector);
    manager.unregisterConnector(connector.id);
    expect(manager.getConnector(connector.id)).toBeUndefined();
    expect(manager.hasConnector(connector.id)).toBe(false);
  });
});

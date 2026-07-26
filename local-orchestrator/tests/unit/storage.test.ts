import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SnapshotService } from "../../src/storage/snapshot-service.js";
import { BuildContextMemory } from "../../src/storage/build-context-memory.js";
import { createTestProject, createTestFile, cleanupTestArtifacts, type TestProject } from "../setup.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

describe("storage/snapshot-service", () => {
  let project: TestProject;
  let service: SnapshotService;

  beforeEach(async () => {
    project = await createTestProject("snapshot");
    service = new SnapshotService();
  });

  afterEach(async () => {
    await cleanupTestArtifacts(project.dir);
    await project.cleanup();
  });

  it("capturePreWrite creates a snapshot with id and timestamp", async () => {
    const filePath = await createTestFile(project, "test.txt", "original content");
    const snapshotId = await service.capturePreWrite(filePath, Buffer.from("original content"), "test-project");

    expect(snapshotId).toBeTruthy();
    expect(typeof snapshotId).toBe("string");
    expect(snapshotId.length).toBeGreaterThan(0);
  });

  it("restore returns original content", async () => {
    const filePath = await createTestFile(project, "test.txt", "original content");
    const snapshotId = await service.capturePreWrite(filePath, Buffer.from("original content"), "test-project");

    const restored = await service.restore(snapshotId);
    expect(restored).toBeDefined();
    expect(restored!.toString()).toBe("original content");
  });

  it("restore returns undefined for unknown snapshot", async () => {
    const restored = await service.restore("nonexistent-id");
    expect(restored).toBeUndefined();
  });

  it("listSnapshots returns snapshots for a project", async () => {
    const filePath = await createTestFile(project, "test.txt", "content");
    await service.capturePreWrite(filePath, Buffer.from("content"), "project-a");
    await service.capturePreWrite(filePath, Buffer.from("content"), "project-b");

    const snapsA = await service.listSnapshots("project-a");
    expect(snapsA).toHaveLength(1);
    expect(snapsA[0].projectId).toBe("project-a");
  });

  it("deleteSnapshot removes the snapshot", async () => {
    const filePath = await createTestFile(project, "test.txt", "content");
    const snapshotId = await service.capturePreWrite(filePath, Buffer.from("content"), "test-project");

    const deleted = await service.deleteSnapshot(snapshotId);
    expect(deleted).toBe(true);

    const restored = await service.restore(snapshotId);
    expect(restored).toBeUndefined();
  });

  it("writeToDisk restores file to original content", async () => {
    const filePath = await createTestFile(project, "test.txt", "original");
    const snapshotId = await service.capturePreWrite(filePath, Buffer.from("original"), "test-project");

    // Overwrite the file
    const { writeFile } = await import("node:fs/promises");
    await writeFile(filePath, "modified", "utf-8");

    // Restore from snapshot
    const success = await service.writeToDisk(snapshotId, filePath);
    expect(success).toBe(true);

    const content = await readFile(filePath, "utf-8");
    expect(content).toBe("original");
  });
});

describe("storage/build-context-memory", () => {
  let project: TestProject;
  let memory: BuildContextMemory;

  beforeEach(async () => {
    project = await createTestProject("memory");
    // We need to change cwd to the project dir since BuildContextMemory uses process.cwd()
    process.chdir(project.dir);
    memory = new BuildContextMemory();
  });

  afterEach(async () => {
    await cleanupTestArtifacts(project.dir);
    await project.cleanup();
    process.chdir("/home/ubuntu/Workspace/Gemork");
  });

  it("log writes entry to JSON file", async () => {
    const entry = await memory.log({
      agentId: "agent-1",
      action: "read_file",
      rationale: "Reading config",
      projectId: "test-project",
    });

    expect(entry.id).toBeTruthy();
    expect(entry.timestamp).toBeTruthy();
    expect(entry.agentId).toBe("agent-1");
    expect(entry.action).toBe("read_file");
  });

  it("queryByProject returns correct entries", async () => {
    await memory.log({
      agentId: "agent-1",
      action: "read",
      rationale: "test",
      projectId: "proj-a",
    });
    await memory.log({
      agentId: "agent-2",
      action: "write",
      rationale: "test",
      projectId: "proj-b",
    });

    const entries = await memory.queryByProject("proj-a");
    expect(entries).toHaveLength(1);
    expect(entries[0].projectId).toBe("proj-a");
  });

  it("queryByAgent filters correctly", async () => {
    await memory.log({
      agentId: "agent-1",
      action: "read",
      rationale: "test",
      projectId: "proj-a",
    });
    await memory.log({
      agentId: "agent-2",
      action: "write",
      rationale: "test",
      projectId: "proj-a",
    });

    const entries = await memory.queryByAgent("agent-1", "proj-a");
    expect(entries).toHaveLength(1);
    expect(entries[0].agentId).toBe("agent-1");
  });

  it("deleteEntry removes an entry", async () => {
    const entry = await memory.log({
      agentId: "agent-1",
      action: "test",
      rationale: "test",
      projectId: "proj-a",
    });

    const deleted = await memory.deleteEntry(entry.id, "proj-a");
    expect(deleted).toBe(true);

    const remaining = await memory.queryByProject("proj-a");
    expect(remaining).toHaveLength(0);
  });

  it("getEntryCount returns correct count", async () => {
    expect(await memory.getEntryCount("proj-a")).toBe(0);
    await memory.log({ agentId: "a", action: "1", rationale: "", projectId: "proj-a" });
    await memory.log({ agentId: "a", action: "2", rationale: "", projectId: "proj-a" });
    expect(await memory.getEntryCount("proj-a")).toBe(2);
  });

  it("multiple entries maintain chronological order", async () => {
    await memory.log({ agentId: "a", action: "first", rationale: "", projectId: "proj" });
    await memory.log({ agentId: "a", action: "second", rationale: "", projectId: "proj" });
    await memory.log({ agentId: "a", action: "third", rationale: "", projectId: "proj" });

    const recent = await memory.queryRecent(2, "proj");
    expect(recent).toHaveLength(2);
    // Most recent first
    expect(recent[0].action).toBe("third");
    expect(recent[1].action).toBe("second");
  });
});

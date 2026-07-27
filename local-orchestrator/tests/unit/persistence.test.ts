import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ChatStore } from "../../src/persistence/chat-store.js";
import { StateSaver, type TaskState } from "../../src/persistence/state-saver.js";
import { ResumeManager } from "../../src/persistence/resume-manager.js";
import { createTestProject, cleanupTestArtifacts, type TestProject } from "../setup.js";

describe("persistence/chat-store", () => {
  let project: TestProject;
  let store: ChatStore;

  beforeEach(async () => {
    project = await createTestProject("chat-store");
    process.chdir(project.dir);
    store = new ChatStore();
  });

  afterEach(async () => {
    await cleanupTestArtifacts(project.dir);
    await project.cleanup();
    process.chdir("/home/ubuntu/Workspace/Gemork");
  });

  it("appendEntry creates entry with id and timestamp", async () => {
    const entry = await store.appendEntry("proj", "sess1", {
      role: "user",
      content: "Hello",
    });

    expect(entry.id).toBeTruthy();
    expect(entry.timestamp).toBeTruthy();
    expect(entry.role).toBe("user");
    expect(entry.content).toBe("Hello");
  });

  it("getEntries returns entries in order", async () => {
    await store.appendEntry("proj", "sess1", { role: "user", content: "first" });
    await store.appendEntry("proj", "sess1", { role: "assistant", content: "second" });
    await store.appendEntry("proj", "sess1", { role: "user", content: "third" });

    const entries = await store.getEntries("proj", "sess1");
    expect(entries).toHaveLength(3);
    expect(entries[0].content).toBe("first");
    expect(entries[1].content).toBe("second");
    expect(entries[2].content).toBe("third");
  });

  it("getEntries respects limit parameter", async () => {
    for (let i = 0; i < 10; i++) {
      await store.appendEntry("proj", "sess1", { role: "user", content: `msg-${i}` });
    }

    const last3 = await store.getEntries("proj", "sess1", 3);
    expect(last3).toHaveLength(3);
    expect(last3[0].content).toBe("msg-7");
    expect(last3[2].content).toBe("msg-9");
  });

  it("getEntries returns empty array for missing session", async () => {
    const entries = await store.getEntries("proj", "nonexistent");
    expect(entries).toEqual([]);
  });

  it("getSessionIds lists all sessions", async () => {
    await store.appendEntry("proj", "sess-a", { role: "user", content: "a" });
    await store.appendEntry("proj", "sess-b", { role: "user", content: "b" });

    const ids = await store.getSessionIds("proj");
    expect(ids).toEqual(["sess-a", "sess-b"]);
  });

  it("deleteSession removes the session directory", async () => {
    await store.appendEntry("proj", "sess-del", { role: "user", content: "hi" });
    const deleted = await store.deleteSession("proj", "sess-del");
    expect(deleted).toBe(true);

    const entries = await store.getEntries("proj", "sess-del");
    expect(entries).toEqual([]);
  });

  it("getLatestSession returns most recent session", async () => {
    await store.appendEntry("proj", "aaa-first", { role: "user", content: "old" });
    await store.appendEntry("proj", "zzz-last", { role: "user", content: "new" });

    const latest = await store.getLatestSession("proj");
    expect(latest).toBe("zzz-last");
  });

  it("JSONL format is append-only", async () => {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");

    await store.appendEntry("proj", "sess-jsonl", { role: "user", content: "line1" });
    await store.appendEntry("proj", "sess-jsonl", { role: "user", content: "line2" });

    const filePath = join(
      project.dir,
      ".gemork",
      "proj",
      "sessions",
      "sess-jsonl",
      "conversation.jsonl",
    );
    const raw = await readFile(filePath, "utf-8");
    const lines = raw.split("\n").filter((l) => l.trim());
    expect(lines).toHaveLength(2);

    // Each line should be valid JSON
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it("metadata is preserved in entries", async () => {
    const entry = await store.appendEntry("proj", "sess-meta", {
      role: "assistant",
      content: "response",
      metadata: { toolCalls: 3, model: "gemma" },
    });

    const entries = await store.getEntries("proj", "sess-meta");
    expect(entries[0].metadata).toEqual({ toolCalls: 3, model: "gemma" });
  });
});

describe("persistence/state-saver", () => {
  let project: TestProject;
  let saver: StateSaver;

  beforeEach(async () => {
    project = await createTestProject("state-saver");
    process.chdir(project.dir);
    saver = new StateSaver();
  });

  afterEach(async () => {
    await cleanupTestArtifacts(project.dir);
    await project.cleanup();
    process.chdir("/home/ubuntu/Workspace/Gemork");
  });

  it("saveState and loadState round-trip", async () => {
    const state: TaskState = {
      sessionId: "s1",
      planId: "p1",
      goalId: "g1",
      currentStepIndex: 2,
      completedSteps: ["step1", "step2"],
      pendingApprovals: ["step3"],
      startedAt: new Date().toISOString(),
      lastCheckpoint: new Date().toISOString(),
    };

    await saver.saveState("proj", "s1", state);
    const loaded = await saver.loadState("proj", "s1");

    expect(loaded).not.toBeNull();
    expect(loaded!.sessionId).toBe("s1");
    expect(loaded!.planId).toBe("p1");
    expect(loaded!.currentStepIndex).toBe(2);
    expect(loaded!.completedSteps).toEqual(["step1", "step2"]);
    expect(loaded!.pendingApprovals).toEqual(["step3"]);
  });

  it("loadState returns null for missing session", async () => {
    const loaded = await saver.loadState("proj", "nonexistent");
    expect(loaded).toBeNull();
  });

  it("clearState removes the state file", async () => {
    const state: TaskState = {
      sessionId: "s2",
      currentStepIndex: 0,
      completedSteps: [],
      pendingApprovals: [],
      startedAt: new Date().toISOString(),
      lastCheckpoint: new Date().toISOString(),
    };

    await saver.saveState("proj", "s2", state);
    const cleared = await saver.clearState("proj", "s2");
    expect(cleared).toBe(true);

    const loaded = await saver.loadState("proj", "s2");
    expect(loaded).toBeNull();
  });

  it("clearState returns false for missing session", async () => {
    const cleared = await saver.clearState("proj", "nonexistent");
    expect(cleared).toBe(false);
  });

  it("atomic write produces valid JSON", async () => {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");

    const state: TaskState = {
      sessionId: "s3",
      currentStepIndex: 0,
      completedSteps: [],
      pendingApprovals: [],
      startedAt: new Date().toISOString(),
      lastCheckpoint: new Date().toISOString(),
    };

    await saver.saveState("proj", "s3", state);

    const filePath = join(
      project.dir,
      ".gemork",
      "proj",
      "sessions",
      "s3",
      "state.json",
    );
    const raw = await readFile(filePath, "utf-8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("lastCheckpoint is updated on save", async () => {
    const before = new Date().toISOString();
    const state: TaskState = {
      sessionId: "s4",
      currentStepIndex: 0,
      completedSteps: [],
      pendingApprovals: [],
      startedAt: before,
      lastCheckpoint: before,
    };

    await saver.saveState("proj", "s4", state);
    const loaded = await saver.loadState("proj", "s4");

    expect(new Date(loaded!.lastCheckpoint).getTime()).toBeGreaterThanOrEqual(
      new Date(before).getTime(),
    );
  });
});

describe("persistence/resume-manager", () => {
  let project: TestProject;
  let chatStore: ChatStore;
  let stateSaver: StateSaver;
  let manager: ResumeManager;

  beforeEach(async () => {
    project = await createTestProject("resume-manager");
    process.chdir(project.dir);
    chatStore = new ChatStore();
    stateSaver = new StateSaver();
    manager = new ResumeManager(chatStore, stateSaver);
  });

  afterEach(async () => {
    await cleanupTestArtifacts(project.dir);
    await project.cleanup();
    process.chdir("/home/ubuntu/Workspace/Gemork");
  });

  it("canResume returns true when state and conversation exist", async () => {
    await stateSaver.saveState("proj", "s1", {
      sessionId: "s1",
      planId: "p1",
      currentStepIndex: 1,
      completedSteps: ["step1"],
      pendingApprovals: [],
      startedAt: new Date().toISOString(),
      lastCheckpoint: new Date().toISOString(),
    });
    await chatStore.appendEntry("proj", "s1", { role: "user", content: "hi" });

    const can = await manager.canResume("proj", "s1");
    expect(can).toBe(true);
  });

  it("canResume returns false when no state", async () => {
    const can = await manager.canResume("proj", "nonexistent");
    expect(can).toBe(false);
  });

  it("canResume returns false when conversation empty", async () => {
    await stateSaver.saveState("proj", "s2", {
      sessionId: "s2",
      planId: "p1",
      currentStepIndex: 1,
      completedSteps: [],
      pendingApprovals: [],
      startedAt: new Date().toISOString(),
      lastCheckpoint: new Date().toISOString(),
    });

    const can = await manager.canResume("proj", "s2");
    expect(can).toBe(false);
  });

  it("resumeSession returns success with state and entries", async () => {
    const startedAt = new Date(Date.now() - 60000).toISOString();
    await stateSaver.saveState("proj", "s3", {
      sessionId: "s3",
      planId: "p1",
      currentStepIndex: 2,
      completedSteps: ["step1", "step2"],
      pendingApprovals: ["step3"],
      startedAt,
      lastCheckpoint: new Date().toISOString(),
    });
    await chatStore.appendEntry("proj", "s3", { role: "user", content: "hello" });
    await chatStore.appendEntry("proj", "s3", { role: "assistant", content: "hi" });

    const result = await manager.resumeSession("proj", "s3");
    expect(result.resumed).toBe(true);
    expect(result.state).not.toBeNull();
    expect(result.entries).toHaveLength(2);
    expect(result.message).toContain("2 steps completed");
    expect(result.message).toContain("1 pending approvals");
  });

  it("resumeSession handles missing state gracefully", async () => {
    const result = await manager.resumeSession("proj", "nonexistent");
    expect(result.resumed).toBe(false);
    expect(result.state).toBeNull();
    expect(result.message).toContain("No saved state found");
  });

  it("resumeSession handles corrupted state gracefully", async () => {
    const { writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");

    const stateDir = join(project.dir, ".gemork", "proj", "sessions", "corrupt");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(stateDir, { recursive: true });
    // Valid JSON but missing required fields (sessionId, currentStepIndex)
    await writeFile(join(stateDir, "state.json"), JSON.stringify({ foo: "bar" }), "utf-8");

    const result = await manager.resumeSession("proj", "corrupt");
    expect(result.resumed).toBe(false);
    expect(result.message).toContain("corrupted");
  });

  it("resumeSession handles empty conversation with state", async () => {
    await stateSaver.saveState("proj", "s4", {
      sessionId: "s4",
      planId: "p1",
      currentStepIndex: 0,
      completedSteps: [],
      pendingApprovals: [],
      startedAt: new Date().toISOString(),
      lastCheckpoint: new Date().toISOString(),
    });

    const result = await manager.resumeSession("proj", "s4");
    expect(result.resumed).toBe(false);
    expect(result.message).toContain("conversation is empty");
  });

  it("resumeSession handles state with no planId", async () => {
    await stateSaver.saveState("proj", "s5", {
      sessionId: "s5",
      currentStepIndex: 1,
      completedSteps: ["step1"],
      pendingApprovals: [],
      startedAt: new Date().toISOString(),
      lastCheckpoint: new Date().toISOString(),
    });
    await chatStore.appendEntry("proj", "s5", { role: "user", content: "hi" });

    const result = await manager.resumeSession("proj", "s5");
    expect(result.resumed).toBe(false);
    expect(result.message).toContain("no plan ID");
  });
});

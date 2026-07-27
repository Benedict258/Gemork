import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import {
  createInboxItem,
  compareInboxPriority,
  type InboxItem,
} from "../../src/inbox/inbox-item.js";
import { InboxStore } from "../../src/inbox/inbox-store.js";
import { InboxManager } from "../../src/inbox/inbox-manager.js";

const TEST_DIR = join(import.meta.dirname ?? ".", ".test-inbox");
const PROJECT_ID = "test-project";

function cleanupTestDir() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

function makeApprovalPayload() {
  return {
    planId: "plan-1",
    stepId: "step-1",
    description: "Delete production database",
    tier: 3,
    rationale: "Need to reset for migration",
  };
}

function makeQuestionPayload() {
  return {
    question: "What database should we use?",
    context: "We need a relational database",
    options: ["postgres", "mysql", "sqlite"],
  };
}

function makeNotificationPayload() {
  return {
    message: "Backup completed successfully",
    level: "info" as const,
  };
}

describe("InboxItem", () => {
  it("creates a valid inbox item with id, status, and timestamps", () => {
    const item = createInboxItem("approval", makeApprovalPayload());
    expect(item.id).toBeTruthy();
    expect(item.type).toBe("approval");
    expect(item.status).toBe("pending");
    expect(item.payload).toEqual(makeApprovalPayload());
    expect(item.createdAt).toBeInstanceOf(Date);
  });

  it("creates unique ids for different items", () => {
    const a = createInboxItem("approval", makeApprovalPayload());
    const b = createInboxItem("question", makeQuestionPayload());
    expect(a.id).not.toBe(b.id);
  });

  it("compareInboxPriority sorts approval before question before notification", () => {
    const approval = createInboxItem("approval", makeApprovalPayload());
    const question = createInboxItem("question", makeQuestionPayload());
    const notification = createInboxItem("notification", makeNotificationPayload());

    expect(compareInboxPriority(approval, question)).toBeLessThan(0);
    expect(compareInboxPriority(approval, notification)).toBeLessThan(0);
    expect(compareInboxPriority(question, notification)).toBeLessThan(0);
    expect(compareInboxPriority(question, approval)).toBeGreaterThan(0);
    expect(compareInboxPriority(notification, approval)).toBeGreaterThan(0);
  });
});

describe("InboxStore", () => {
  let store: InboxStore;

  beforeEach(() => {
    cleanupTestDir();
    mkdirSync(join(TEST_DIR, PROJECT_ID), { recursive: true });
    store = new InboxStore(PROJECT_ID, TEST_DIR);
  });

  afterEach(() => {
    cleanupTestDir();
  });

  it("adds and retrieves an item", () => {
    const item = createInboxItem("approval", makeApprovalPayload());
    store.addItem(item);
    const retrieved = store.getItem(item.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(item.id);
    expect(retrieved!.type).toBe("approval");
  });

  it("returns null for nonexistent item", () => {
    expect(store.getItem("nonexistent")).toBeNull();
  });

  it("getPendingItems returns only pending items", () => {
    const a = createInboxItem("approval", makeApprovalPayload());
    const b = createInboxItem("question", makeQuestionPayload());
    store.addItem(a);
    store.addItem(b);

    expect(store.getPendingItems()).toHaveLength(2);

    store.resolveItem(a.id);
    expect(store.getPendingItems()).toHaveLength(1);
    expect(store.getPendingItems()[0].id).toBe(b.id);
  });

  it("resolveItem marks item as resolved with response", () => {
    const item = createInboxItem("question", makeQuestionPayload());
    store.addItem(item);
    store.resolveItem(item.id, { answer: "postgres" });

    const resolved = store.getItem(item.id);
    expect(resolved!.status).toBe("resolved");
    expect(resolved!.resolvedAt).toBeInstanceOf(Date);
  });

  it("resolveItem throws for nonexistent item", () => {
    expect(() => store.resolveItem("bad-id")).toThrow("not found");
  });

  it("resolveItem throws for already resolved item", () => {
    const item = createInboxItem("approval", makeApprovalPayload());
    store.addItem(item);
    store.resolveItem(item.id);
    expect(() => store.resolveItem(item.id)).toThrow("already resolved");
  });

  it("cancelItem marks item as cancelled", () => {
    const item = createInboxItem("notification", makeNotificationPayload());
    store.addItem(item);
    store.cancelItem(item.id);

    const cancelled = store.getItem(item.id);
    expect(cancelled!.status).toBe("cancelled");
  });

  it("cancelItem throws for nonexistent item", () => {
    expect(() => store.cancelItem("bad-id")).toThrow("not found");
  });

  it("getStats returns correct counts", () => {
    const a = createInboxItem("approval", makeApprovalPayload());
    const b = createInboxItem("question", makeQuestionPayload());
    const c = createInboxItem("notification", makeNotificationPayload());
    store.addItem(a);
    store.addItem(b);
    store.addItem(c);

    expect(store.getStats()).toEqual({ pending: 3, resolved: 0, cancelled: 0 });

    store.resolveItem(a.id);
    store.cancelItem(b.id);
    expect(store.getStats()).toEqual({ pending: 1, resolved: 1, cancelled: 1 });
  });

  it("persists to disk and survives restart", () => {
    const item = createInboxItem("approval", makeApprovalPayload());
    store.addItem(item);

    const filePath = join(TEST_DIR, PROJECT_ID, "inbox.json");
    expect(existsSync(filePath)).toBe(true);

    const raw = readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw);
    expect(data.items).toHaveLength(1);
    expect(data.items[0].id).toBe(item.id);

    const newStore = new InboxStore(PROJECT_ID, TEST_DIR);
    const retrieved = newStore.getItem(item.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(item.id);
    expect(retrieved!.type).toBe("approval");
  });
});

describe("InboxManager", () => {
  let manager: InboxManager;

  beforeEach(() => {
    cleanupTestDir();
    mkdirSync(join(TEST_DIR, PROJECT_ID), { recursive: true });
    manager = new InboxManager(PROJECT_ID, TEST_DIR);
  });

  afterEach(() => {
    cleanupTestDir();
  });

  it("enqueues items and returns id", () => {
    const id = manager.enqueue({
      type: "approval",
      payload: makeApprovalPayload(),
    });
    expect(id).toBeTruthy();
    expect(manager.getPendingCount()).toBe(1);
  });

  it("next() returns the highest priority pending item", () => {
    manager.enqueue({ type: "notification", payload: makeNotificationPayload() });
    manager.enqueue({ type: "approval", payload: makeApprovalPayload() });
    manager.enqueue({ type: "question", payload: makeQuestionPayload() });

    const next = manager.next();
    expect(next).not.toBeNull();
    expect(next!.type).toBe("approval");
  });

  it("next() returns null when no pending items", () => {
    expect(manager.next()).toBeNull();
  });

  it("resolve() removes item from pending and emits event", () => {
    let resolvedEvent: any = null;
    manager.onItemResolved((event) => {
      resolvedEvent = event;
    });

    const id = manager.enqueue({ type: "approval", payload: makeApprovalPayload() });
    manager.resolve(id, { approved: true });

    expect(manager.getPendingCount()).toBe(0);
    expect(resolvedEvent).not.toBeNull();
    expect(resolvedEvent.item.id).toBe(id);
    expect(resolvedEvent.response).toEqual({ approved: true });
  });

  it("cancel() removes item from pending and emits event", () => {
    let cancelledEvent: any = null;
    manager.onItemAdded((event) => {
      // We need to listen to the specific cancel event
    });
    manager.on("item:cancelled", (event: any) => {
      cancelledEvent = event;
    });

    const id = manager.enqueue({ type: "question", payload: makeQuestionPayload() });
    manager.cancel(id);

    expect(manager.getPendingCount()).toBe(0);
    expect(cancelledEvent).not.toBeNull();
    expect(cancelledEvent.item.id).toBe(id);
  });

  it("getCurrentItem returns the current item", () => {
    const id = manager.enqueue({ type: "approval", payload: makeApprovalPayload() });
    const current = manager.getCurrentItem();
    expect(current).not.toBeNull();
    expect(current!.id).toBe(id);
  });

  it("getCurrentItem is null after resolve", () => {
    const id = manager.enqueue({ type: "approval", payload: makeApprovalPayload() });
    manager.resolve(id);
    expect(manager.getCurrentItem()).toBeNull();
  });

  it("queue ordering: approval before notification", () => {
    manager.enqueue({ type: "notification", payload: makeNotificationPayload() });
    manager.enqueue({ type: "approval", payload: makeApprovalPayload() });

    const next = manager.next();
    expect(next!.type).toBe("approval");
  });

  it("queue ordering: question before notification", () => {
    manager.enqueue({ type: "notification", payload: makeNotificationPayload() });
    manager.enqueue({ type: "question", payload: makeQuestionPayload() });

    const next = manager.next();
    expect(next!.type).toBe("question");
  });

  it("getStats returns correct counts", () => {
    const a = manager.enqueue({ type: "approval", payload: makeApprovalPayload() });
    const b = manager.enqueue({ type: "question", payload: makeQuestionPayload() });
    manager.enqueue({ type: "notification", payload: makeNotificationPayload() });

    expect(manager.getStats()).toEqual({ pending: 3, resolved: 0, cancelled: 0 });

    manager.resolve(a);
    manager.cancel(b);
    expect(manager.getStats()).toEqual({ pending: 1, resolved: 1, cancelled: 1 });
  });

  it("persists across restarts", () => {
    manager.enqueue({ type: "approval", payload: makeApprovalPayload() });
    manager.enqueue({ type: "question", payload: makeQuestionPayload() });

    const newManager = new InboxManager(PROJECT_ID, TEST_DIR);
    expect(newManager.getPendingCount()).toBe(2);
    expect(newManager.getCurrentItem()).not.toBeNull();
  });

  it("emits item:added event on enqueue", () => {
    let addedEvent: any = null;
    manager.onItemAdded((event) => {
      addedEvent = event;
    });

    manager.enqueue({ type: "approval", payload: makeApprovalPayload() });

    expect(addedEvent).not.toBeNull();
    expect(addedEvent.type).toBe("item:added");
    expect(addedEvent.item.type).toBe("approval");
  });

  it("handles multiple sequential enqueues correctly", () => {
    manager.enqueue({ type: "approval", payload: makeApprovalPayload() });
    manager.enqueue({ type: "question", payload: makeQuestionPayload() });
    manager.enqueue({ type: "notification", payload: makeNotificationPayload() });

    expect(manager.getPendingCount()).toBe(3);

    const first = manager.getCurrentItem();
    expect(first!.type).toBe("approval");

    manager.resolve(first!.id);
    const second = manager.getCurrentItem();
    expect(second!.type).toBe("question");

    manager.resolve(second!.id);
    const third = manager.getCurrentItem();
    expect(third!.type).toBe("notification");

    manager.resolve(third!.id);
    expect(manager.getCurrentItem()).toBeNull();
    expect(manager.getPendingCount()).toBe(0);
  });
});

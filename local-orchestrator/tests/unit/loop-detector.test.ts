import { describe, it, expect, beforeEach } from "vitest";
import { RepeatDetector } from "../../src/loop-detector/repeat-detector.js";
import { NavigationDetector } from "../../src/loop-detector/navigation-detector.js";
import { CoordinateDetector } from "../../src/loop-detector/coordinate-detector.js";
import { LoopDetector } from "../../src/loop-detector/loop-detector.js";

// ─── Repeat Detector ─────────────────────────────────────────

describe("RepeatDetector", () => {
  let detector: RepeatDetector;

  beforeEach(() => {
    detector = new RepeatDetector();
  });

  it("catches 3 identical actions in a row", () => {
    detector.addAction("click submit button");
    detector.addAction("click submit button");
    expect(detector.isStuck()).toBe(false);

    detector.addAction("click submit button");
    expect(detector.isStuck()).toBe(true);
  });

  it("allows different actions", () => {
    detector.addAction("read file");
    detector.addAction("edit file");
    detector.addAction("run tests");
    expect(detector.isStuck()).toBe(false);
  });

  it("detects frequency-based repeat (5 of same in last 10)", () => {
    const actions = [
      "click a",
      "click b",
      "click a",
      "click c",
      "click a",
      "click d",
      "click a",
      "click e",
      "click a",
      "click f",
    ];
    for (const a of actions) detector.addAction(a);
    expect(detector.isStuck()).toBe(true);
  });

  it("resets correctly", () => {
    detector.addAction("test");
    detector.addAction("test");
    detector.addAction("test");
    expect(detector.isStuck()).toBe(true);

    detector.reset();
    expect(detector.isStuck()).toBe(false);
  });

  it("normalizes actions (trim, lowercase, collapse whitespace)", () => {
    detector.addAction("  Click  Submit  ");
    detector.addAction("click submit");
    detector.addAction("  click  submit  ");
    expect(detector.isStuck()).toBe(true);
  });

  it("respects custom thresholds", () => {
    const custom = new RepeatDetector({ consecutiveThreshold: 2 });
    custom.addAction("a");
    custom.addAction("a");
    expect(custom.isStuck()).toBe(true);
  });

  it("returns correct repeat count", () => {
    detector.addAction("x");
    detector.addAction("x");
    detector.addAction("x");
    detector.addAction("x");
    expect(detector.getRepeatCount()).toBe(4);
  });
});

// ─── Navigation Detector ─────────────────────────────────────

describe("NavigationDetector", () => {
  let detector: NavigationDetector;

  beforeEach(() => {
    detector = new NavigationDetector();
  });

  it("catches A→B→A pattern (2-cycle)", () => {
    detector.addVisit("/page-a");
    detector.addVisit("/page-b");
    detector.addVisit("/page-a");
    detector.addVisit("/page-b");
    expect(detector.isLooping()).toBe(true);
  });

  it("catches A→B→C→A pattern (3-cycle)", () => {
    detector.addVisit("/a");
    detector.addVisit("/b");
    detector.addVisit("/c");
    detector.addVisit("/a");
    detector.addVisit("/b");
    detector.addVisit("/c");
    expect(detector.isLooping()).toBe(true);
  });

  it("catches consecutive same URL (3x)", () => {
    detector.addVisit("/same");
    detector.addVisit("/same");
    detector.addVisit("/same");
    expect(detector.isLooping()).toBe(true);
  });

  it("allows A→B→C progression", () => {
    detector.addVisit("/a");
    detector.addVisit("/b");
    detector.addVisit("/c");
    detector.addVisit("/d");
    expect(detector.isLooping()).toBe(false);
  });

  it("returns loop pattern", () => {
    detector.addVisit("/a");
    detector.addVisit("/b");
    detector.addVisit("/a");
    detector.addVisit("/b");
    const pattern = detector.getLoopPattern();
    expect(pattern).toContain("/a");
    expect(pattern).toContain("/b");
  });

  it("resets correctly", () => {
    detector.addVisit("/a");
    detector.addVisit("/a");
    detector.addVisit("/a");
    expect(detector.isLooping()).toBe(true);

    detector.reset();
    expect(detector.isLooping()).toBe(false);
  });

  it("normalizes URLs", () => {
    detector.addVisit("  /Page-A  ");
    detector.addVisit("/page-a");
    detector.addVisit("  /Page-A  ");
    detector.addVisit("/page-a");
    expect(detector.isLooping()).toBe(true);
  });
});

// ─── Coordinate Detector ─────────────────────────────────────

describe("CoordinateDetector", () => {
  let detector: CoordinateDetector;

  beforeEach(() => {
    detector = new CoordinateDetector();
  });

  it("catches read→edit→read→edit cycle", () => {
    detector.addToolCall("read_file", "content a");
    detector.addToolCall("edit_file", "changed a");
    detector.addToolCall("read_file", "content a");
    detector.addToolCall("edit_file", "changed a");
    expect(detector.isLooping()).toBe(true);
  });

  it("catches strict A→B→A→B tool alternation without progress", () => {
    detector.addToolCall("tool_a", "same");
    detector.addToolCall("tool_b", "same");
    detector.addToolCall("tool_a", "same");
    detector.addToolCall("tool_b", "same");
    expect(detector.isLooping()).toBe(true);
  });

  it("does not flag read→edit→read→edit when results differ (progress)", () => {
    detector.addToolCall("read_file", "content v1");
    detector.addToolCall("edit_file", "changed v1");
    detector.addToolCall("read_file", "content v2");
    detector.addToolCall("edit_file", "changed v2");
    // Different results mean progress — no loop
    expect(detector.isLooping()).toBe(false);
  });

  it("allows different tool sequences", () => {
    detector.addToolCall("read_file", "r1");
    detector.addToolCall("edit_file", "r2");
    detector.addToolCall("run_tests", "r3");
    detector.addToolCall("write_file", "r4");
    expect(detector.isLooping()).toBe(false);
  });

  it("resets correctly", () => {
    detector.addToolCall("a", "r");
    detector.addToolCall("b", "r");
    detector.addToolCall("a", "r");
    detector.addToolCall("b", "r");
    expect(detector.isLooping()).toBe(true);

    detector.reset();
    expect(detector.isLooping()).toBe(false);
  });

  it("returns pattern description", () => {
    detector.addToolCall("read_file", "same");
    detector.addToolCall("edit_file", "same");
    detector.addToolCall("read_file", "same");
    detector.addToolCall("edit_file", "same");
    const pattern = detector.getLoopPattern();
    expect(pattern).toBeTruthy();
    expect(pattern).toContain("edit");
  });
});

// ─── Combined Loop Detector ──────────────────────────────────

describe("LoopDetector (combined)", () => {
  let detector: LoopDetector;

  beforeEach(() => {
    detector = new LoopDetector();
  });

  it("detects repeat loop and returns suggestion", () => {
    const r1 = detector.detectLoop({ action: "click submit", stepId: "s1" });
    const r2 = detector.detectLoop({ action: "click submit", stepId: "s2" });
    const r3 = detector.detectLoop({ action: "click submit", stepId: "s3" });

    expect(r1.stuck).toBe(false);
    expect(r2.stuck).toBe(false);
    expect(r3.stuck).toBe(true);
    expect(r3.type).toBe("repeat");
    expect(r3.suggestion).toBeTruthy();
  });

  it("detects navigation loop", () => {
    detector.detectLoop({ url: "/a", stepId: "s1" });
    detector.detectLoop({ url: "/b", stepId: "s2" });
    detector.detectLoop({ url: "/a", stepId: "s3" });
    const r = detector.detectLoop({ url: "/b", stepId: "s4" });

    expect(r.stuck).toBe(true);
    expect(r.type).toBe("navigation");
  });

  it("detects coordinate loop", () => {
    detector.detectLoop({ toolCall: "read_file", toolResult: "v1", stepId: "s1" });
    detector.detectLoop({ toolCall: "edit_file", toolResult: "v2", stepId: "s2" });
    detector.detectLoop({ toolCall: "read_file", toolResult: "v1", stepId: "s3" });
    const r = detector.detectLoop({ toolCall: "edit_file", toolResult: "v2", stepId: "s4" });

    expect(r.stuck).toBe(true);
    expect(r.type).toBe("coordinate");
  });

  it("returns not stuck for fresh detector", () => {
    const r = detector.detectLoop({ action: "do something", stepId: "s1" });
    expect(r.stuck).toBe(false);
  });

  it("auto-resets after detection prevents false positives", () => {
    // Trigger a repeat loop
    detector.detectLoop({ action: "test", stepId: "s1" });
    detector.detectLoop({ action: "test", stepId: "s2" });
    detector.detectLoop({ action: "test", stepId: "s3" }); // detected

    // Next action should not be stuck (auto-reset)
    const r = detector.detectLoop({ action: "different", stepId: "s4" });
    expect(r.stuck).toBe(false);
  });

  it("manual reset clears all detectors", () => {
    detector.detectLoop({ action: "a", stepId: "s1" });
    detector.detectLoop({ action: "a", stepId: "s2" });
    detector.detectLoop({ action: "a", stepId: "s3" });

    detector.reset();

    const r = detector.detectLoop({ action: "a", stepId: "s4" });
    expect(r.stuck).toBe(false);
  });

  it("handles mixed context (action + url)", () => {
    // Feed navigation visits — 2-cycle detected at s4
    detector.detectLoop({ url: "/x", stepId: "s1" });
    detector.detectLoop({ url: "/y", stepId: "s2" });
    detector.detectLoop({ url: "/x", stepId: "s3" });
    detector.detectLoop({ url: "/y", stepId: "s4" });

    // After detection + auto-reset, next visit starts fresh
    const r = detector.detectLoop({ url: "/x", stepId: "s5" });
    expect(r.stuck).toBe(false);
  });
});

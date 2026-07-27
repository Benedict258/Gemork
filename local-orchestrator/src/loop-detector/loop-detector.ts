import { RepeatDetector } from "./repeat-detector.js";
import { NavigationDetector } from "./navigation-detector.js";
import { CoordinateDetector } from "./coordinate-detector.js";

export type LoopType = "repeat" | "navigation" | "coordinate";

export interface LoopContext {
  action?: string;
  url?: string;
  toolCall?: string;
  toolResult?: string;
  stepId: string;
}

export interface LoopResult {
  stuck: boolean;
  type?: LoopType;
  pattern?: string;
  suggestion?: string;
}

export interface LoopDetectorConfig {
  repeat?: {
    windowSize?: number;
    consecutiveThreshold?: number;
    frequencyThreshold?: number;
  };
  navigation?: {
    historySize?: number;
    repeatThreshold?: number;
  };
  coordinate?: {
    historySize?: number;
    alternatingThreshold?: number;
  };
}

export class LoopDetector {
  private repeat: RepeatDetector;
  private navigation: NavigationDetector;
  private coordinate: CoordinateDetector;
  private autoReset: boolean;

  constructor(config?: LoopDetectorConfig, autoReset = true) {
    this.repeat = new RepeatDetector(config?.repeat);
      this.navigation = new NavigationDetector(config?.navigation);
    this.coordinate = new CoordinateDetector(config?.coordinate);
    this.autoReset = autoReset;
  }

  detectLoop(context: LoopContext): LoopResult {
    // Feed data into individual detectors
    if (context.action) {
      this.repeat.addAction(context.action);
    }
    if (context.url) {
      this.navigation.addVisit(context.url);
    }
    if (context.toolCall && context.toolResult) {
      this.coordinate.addToolCall(context.toolCall, context.toolResult);
    }

    // Check coordinate first (most specific)
    if (context.toolCall && this.coordinate.isLooping()) {
      const pattern = this.coordinate.getLoopPattern();
      const result: LoopResult = {
        stuck: true,
        type: "coordinate",
        pattern: pattern ?? undefined,
        suggestion: this.suggestForCoordinate(pattern),
      };
      if (this.autoReset) this.reset();
      return result;
    }

    // Check navigation
    if (context.url && this.navigation.isLooping()) {
      const pattern = this.navigation.getLoopPattern();
      const result: LoopResult = {
        stuck: true,
        type: "navigation",
        pattern: pattern ?? undefined,
        suggestion: this.suggestForNavigation(pattern),
      };
      if (this.autoReset) this.reset();
      return result;
    }

    // Check repeat
    if (context.action && this.repeat.isStuck()) {
      const count = this.repeat.getRepeatCount();
      const result: LoopResult = {
        stuck: true,
        type: "repeat",
        pattern: `"${context.action}" repeated ${count} times`,
        suggestion: this.suggestForRepeat(context.action, count),
      };
      if (this.autoReset) this.reset();
      return result;
    }

    return { stuck: false };
  }

  reset(): void {
    this.repeat.reset();
    this.navigation.reset();
    this.coordinate.reset();
  }

  private suggestForRepeat(action: string, count: number): string {
    if (count >= 5) {
      return `Action "${action}" has been repeated ${count} times. Try a completely different approach.`;
    }
    return `Action "${action}" repeated ${count} times. Consider varying your approach or checking if the action is having an effect.`;
  }

  private suggestForNavigation(pattern: string | null): string {
    if (!pattern) return "Navigation loop detected. Try a different path.";
    return `Navigation loop: ${pattern}. Try a different path or approach.`;
  }

  private suggestForCoordinate(pattern: string | null): string {
    if (!pattern) return "Tool cycling detected. Try a different strategy.";
    if (pattern.includes("no progress")) {
      return `Tool cycling detected: ${pattern}. The edit is not producing changes — review the target file content first.`;
    }
    return `Tool cycling detected: ${pattern}. Break the cycle by using a different tool or combining operations.`;
  }
}

// Re-export sub-detectors
export { RepeatDetector } from "./repeat-detector.js";
export { NavigationDetector } from "./navigation-detector.js";
export { CoordinateDetector } from "./coordinate-detector.js";

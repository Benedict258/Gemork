export interface RepeatDetectorConfig {
  /** Number of most recent actions to track (default 10) */
  windowSize?: number;
  /** Consecutive identical actions to flag (default 3) */
  consecutiveThreshold?: number;
  /** Total occurrences in window to flag (default 5) */
  frequencyThreshold?: number;
}

const DEFAULT_WINDOW_SIZE = 10;
const DEFAULT_CONSECUTIVE = 3;
const DEFAULT_FREQUENCY = 5;

function normalizeAction(action: string): string {
  return action.trim().toLowerCase().replace(/\s+/g, " ");
}

export class RepeatDetector {
  private history: string[] = [];
  private windowSize: number;
  private consecutiveThreshold: number;
  private frequencyThreshold: number;

  constructor(config?: RepeatDetectorConfig) {
    this.windowSize = config?.windowSize ?? DEFAULT_WINDOW_SIZE;
    this.consecutiveThreshold = config?.consecutiveThreshold ?? DEFAULT_CONSECUTIVE;
    this.frequencyThreshold = config?.frequencyThreshold ?? DEFAULT_FREQUENCY;
  }

  addAction(action: string): void {
    this.history.push(normalizeAction(action));
    if (this.history.length > this.windowSize) {
      this.history = this.history.slice(-this.windowSize);
    }
  }

  isStuck(): boolean {
    if (this.history.length === 0) return false;

    // Check consecutive repeats
    if (this.consecutiveRepeats() >= this.consecutiveThreshold) return true;

    // Check frequency in window
    if (this.frequencyInWindow() >= this.frequencyThreshold) return true;

    return false;
  }

  getRepeatCount(): number {
    return Math.max(this.consecutiveRepeats(), this.frequencyInWindow());
  }

  reset(): void {
    this.history = [];
  }

  private consecutiveRepeats(): number {
    if (this.history.length === 0) return 0;

    const last = this.history[this.history.length - 1];
    let count = 0;
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i] === last) {
        count++;
      } else {
        break;
      }
    }
    return count;
  }

  private frequencyInWindow(): number {
    if (this.history.length === 0) return 0;

    // Find the most frequent action in the window
    const counts = new Map<string, number>();
    let maxCount = 0;
    for (const action of this.history) {
      const c = (counts.get(action) ?? 0) + 1;
      counts.set(action, c);
      if (c > maxCount) maxCount = c;
    }
    return maxCount;
  }
}

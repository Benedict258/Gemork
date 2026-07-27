export interface NavigationDetectorConfig {
  /** Max history to retain (default 20) */
  historySize?: number;
  /** Consecutive repeats of same URL to flag (default 3) */
  repeatThreshold?: number;
}

const DEFAULT_HISTORY_SIZE = 20;
const DEFAULT_REPEAT_THRESHOLD = 3;

function normalizeUrl(url: string): string {
  return url.trim().toLowerCase();
}

export class NavigationDetector {
  private visits: string[] = [];
  private historySize: number;
  private repeatThreshold: number;

  constructor(config?: NavigationDetectorConfig) {
    this.historySize = config?.historySize ?? DEFAULT_HISTORY_SIZE;
    this.repeatThreshold = config?.repeatThreshold ?? DEFAULT_REPEAT_THRESHOLD;
  }

  addVisit(url: string): void {
    this.visits.push(normalizeUrl(url));
    if (this.visits.length > this.historySize) {
      this.visits = this.visits.slice(-this.historySize);
    }
  }

  isLooping(): boolean {
    if (this.visits.length < 2) return false;

    // Check consecutive same URL
    if (this.consecutiveSameCount() >= this.repeatThreshold) return true;

    // Check 2-cycle loop (A→B→A→B)
    if (this.detectCycle(2)) return true;

    // Check 3-cycle loop (A→B→C→A)
    if (this.detectCycle(3)) return true;

    return false;
  }

  getLoopPattern(): string | null {
    if (this.visits.length < 2) return null;

    const consecutive = this.consecutiveSameCount();
    if (consecutive >= this.repeatThreshold) {
      return `${this.visits[this.visits.length - 1]} (repeated ${consecutive}x)`;
    }

    const cycle2 = this.getCyclePattern(2);
    if (cycle2) return cycle2;

    const cycle3 = this.getCyclePattern(3);
    if (cycle3) return cycle3;

    return null;
  }

  reset(): void {
    this.visits = [];
  }

  private consecutiveSameCount(): number {
    if (this.visits.length === 0) return 0;

    const last = this.visits[this.visits.length - 1];
    let count = 0;
    for (let i = this.visits.length - 1; i >= 0; i--) {
      if (this.visits[i] === last) {
        count++;
      } else {
        break;
      }
    }
    return count;
  }

  private detectCycle(cycleLength: number): boolean {
    return this.getCyclePattern(cycleLength) !== null;
  }

  private getCyclePattern(cycleLength: number): string | null {
    if (this.visits.length < cycleLength * 2) return null;

    const tail = this.visits.slice(-cycleLength * 2);
    const firstHalf = tail.slice(0, cycleLength);
    const secondHalf = tail.slice(cycleLength);

    let isCycle = true;
    for (let i = 0; i < cycleLength; i++) {
      if (firstHalf[i] !== secondHalf[i]) {
        isCycle = false;
        break;
      }
    }

    if (!isCycle) return null;

    const unique = Array.from(new Set(firstHalf));
    return unique.join(" → ") + " → " + unique[0];
  }
}

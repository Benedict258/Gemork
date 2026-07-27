export interface CoordinateDetectorConfig {
  /** Max history to retain (default 20) */
  historySize?: number;
  /** Consecutive alternating tool pairs to flag (default 2) */
  alternatingThreshold?: number;
}

interface ToolCallRecord {
  tool: string;
  resultHash: string;
}

const DEFAULT_HISTORY_SIZE = 20;
const DEFAULT_ALTERNATING_THRESHOLD = 1;

function hashResult(result: string): string {
  // Simple fast hash — not cryptographically secure, just for comparison
  let hash = 0;
  for (let i = 0; i < result.length; i++) {
    hash = ((hash << 5) - hash + result.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

export class CoordinateDetector {
  private calls: ToolCallRecord[] = [];
  private historySize: number;
  private alternatingThreshold: number;

  constructor(config?: CoordinateDetectorConfig) {
    this.historySize = config?.historySize ?? DEFAULT_HISTORY_SIZE;
    this.alternatingThreshold = config?.alternatingThreshold ?? DEFAULT_ALTERNATING_THRESHOLD;
  }

  addToolCall(tool: string, result: string): void {
    this.calls.push({ tool: tool.trim().toLowerCase(), resultHash: hashResult(result) });
    if (this.calls.length > this.historySize) {
      this.calls = this.calls.slice(-this.historySize);
    }
  }

  isLooping(): boolean {
    return this.getLoopPattern() !== null;
  }

  getLoopPattern(): string | null {
    if (this.calls.length < 4) return null;

    // Check alternating A→B→A→B pattern
    const altPattern = this.checkAlternating();
    if (altPattern) return altPattern;

    // Check read→edit→read→edit with identical results (no progress)
    const editLoop = this.checkEditLoop();
    if (editLoop) return editLoop;

    return null;
  }

  reset(): void {
    this.calls = [];
  }

  private checkAlternating(): string | null {
    if (this.calls.length < this.alternatingThreshold * 4) return null;

    const recent = this.calls.slice(-this.alternatingThreshold * 4);

    // Extract tool sequence
    const tools = recent.map((c) => c.tool);

    // Check if it's a strict A→B→A→B... pattern
    if (tools.length >= 4) {
      const a = tools[0];
      const b = tools[1];

      if (a === b) return null; // Not alternating

      let isAlternating = true;
      let resultsSame = true;
      for (let i = 2; i < tools.length; i++) {
        if (tools[i] !== (i % 2 === 0 ? a : b)) {
          isAlternating = false;
          break;
        }
        // Check if result hashes match (no progress)
        if (recent[i].resultHash !== recent[i - 2].resultHash) {
          resultsSame = false;
        }
      }

      if (isAlternating && resultsSame) {
        return `${a} → ${b} (cycling)`;
      }
    }

    return null;
  }

  private checkEditLoop(): string | null {
    if (this.calls.length < 4) return null;

    // Look for read_file → edit_file → read_file → edit_file
    // where the edit produces the same result (no meaningful change)
    for (let i = 3; i < this.calls.length; i++) {
      const curr = this.calls[i];
      const prev = this.calls[i - 1];
      const prevPrev = this.calls[i - 2];
      const prevPrevPrev = this.calls[i - 3];

      if (
        prevPrevPrev.tool.includes("read") &&
        prevPrev.tool.includes("edit") &&
        prev.tool.includes("read") &&
        curr.tool.includes("edit") &&
        prevPrev.resultHash === curr.resultHash
      ) {
        return `read → edit cycle (no progress detected)`;
      }
    }

    return null;
  }
}

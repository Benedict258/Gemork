import { type PlanStep } from "./orchestrator/plan.js";
import { v4 as uuid } from "uuid";

export interface Snapshot {
  id: string;
  stepId: string;
  filePath: string;
  content: Buffer;
  timestamp: Date;
}

export class SnapshotService {
  private snapshots: Map<string, Snapshot> = new Map();

  async capturePreWrite(step: PlanStep, filePath: string, content: Buffer): Promise<Snapshot> {
    const snapshot: Snapshot = {
      id: uuid(),
      stepId: step.id,
      filePath,
      content: Buffer.from(content),
      timestamp: new Date(),
    };
    this.snapshots.set(snapshot.id, snapshot);
    return snapshot;
  }

  async restore(snapshotId: string): Promise<Buffer | undefined> {
    const snapshot = this.snapshots.get(snapshotId);
    return snapshot?.content;
  }

  getSnapshotsForStep(stepId: string): Snapshot[] {
    return Array.from(this.snapshots.values()).filter((s) => s.stepId === stepId);
  }
}

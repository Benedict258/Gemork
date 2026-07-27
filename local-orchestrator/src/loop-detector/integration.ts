import { LoopDetector, type LoopContext, type LoopResult, type LoopDetectorConfig } from "./loop-detector.js";
import type { OrchestratorEventBus } from "../orchestrator/event-bus.js";
import { BuildContextMemory } from "../storage/build-context-memory.js";

export interface LoopDetectionIntegrationConfig {
  loopDetector?: LoopDetectorConfig;
  autoReset?: boolean;
  projectId?: string;
}

export interface LoopDetectionEvent {
  type: "loop:detected";
  result: LoopResult;
  context: LoopContext;
  timestamp: Date;
}

export class LoopDetectionIntegration {
  private detector: LoopDetector;
  private memory: BuildContextMemory;
  private projectId: string;

  constructor(config?: LoopDetectionIntegrationConfig) {
    this.detector = new LoopDetector(config?.loopDetector, config?.autoReset ?? true);
    this.memory = new BuildContextMemory();
    this.projectId = config?.projectId ?? "default";
  }

  async checkLoop(
    context: LoopContext,
    eventBus?: OrchestratorEventBus,
  ): Promise<LoopResult> {
    const result = this.detector.detectLoop(context);

    if (result.stuck) {
      // Emit event
      if (eventBus) {
        eventBus.publish({
          type: "step:failed" as const,
          planId: context.stepId,
          step: {
            id: context.stepId,
            goalId: "",
            description: `Loop detected: ${result.type}`,
            tier: 1,
            status: "failed",
            error: result.suggestion ?? "Loop detected",
          },
          error: result.suggestion ?? "Loop detected",
          timestamp: new Date(),
        } as any);
      }

      // Log to BuildContextMemory
      try {
        await this.memory.log({
          agentId: "loop-detector",
          action: `loop:detected:${result.type}`,
          rationale: result.suggestion ?? "Loop detected",
          projectId: this.projectId,
          stepId: context.stepId,
        });
      } catch {
        // Memory logging is best-effort
      }
    }

    return result;
  }

  reset(): void {
    this.detector.reset();
  }

  getDetector(): LoopDetector {
    return this.detector;
  }
}

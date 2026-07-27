import { ChatStore, type ChatEntry } from "./chat-store.js";
import { StateSaver, type TaskState } from "./state-saver.js";

export interface ResumeResult {
  resumed: boolean;
  state: TaskState | null;
  entries: ChatEntry[];
  message: string;
}

export class ResumeManager {
  private chatStore: ChatStore;
  private stateSaver: StateSaver;

  constructor(chatStore?: ChatStore, stateSaver?: StateSaver) {
    this.chatStore = chatStore ?? new ChatStore();
    this.stateSaver = stateSaver ?? new StateSaver();
  }

  async canResume(projectId: string, sessionId: string): Promise<boolean> {
    const state = await this.stateSaver.loadState(projectId, sessionId);
    if (!state || state === "corrupted") return false;

    // If plan completed or no steps left, nothing to resume
    if (state.currentStepIndex < 0) return false;

    // Check conversation has at least one entry
    const entries = await this.chatStore.getEntries(projectId, sessionId, 1);
    return entries.length > 0;
  }

  async resumeSession(
    projectId: string,
    sessionId: string,
  ): Promise<ResumeResult> {
    const stateResult = await this.stateSaver.loadState(projectId, sessionId);
    const entries = await this.chatStore.getEntries(projectId, sessionId);

    if (stateResult === "corrupted") {
      return {
        resumed: false,
        state: null,
        entries,
        message: "State file is corrupted. Starting fresh.",
      };
    }

    if (!stateResult) {
      return {
        resumed: false,
        state: null,
        entries,
        message: "No saved state found. Starting fresh.",
      };
    }

    const state = stateResult;

    if (entries.length === 0) {
      return {
        resumed: false,
        state,
        entries: [],
        message: "State found but conversation is empty. Starting fresh.",
      };
    }

    // Validate state integrity
    if (!state.sessionId || typeof state.currentStepIndex !== "number") {
      return {
        resumed: false,
        state: null,
        entries,
        message: "State file is corrupted. Starting fresh.",
      };
    }

    // Check if plan is still valid (planId should exist)
    if (!state.planId) {
      return {
        resumed: false,
        state,
        entries,
        message: "State has no plan ID. Starting fresh.",
      };
    }

    const completedCount = state.completedSteps.length;
    const pendingCount = state.pendingApprovals.length;
    const elapsed = state.startedAt
      ? Math.round((Date.now() - new Date(state.startedAt).getTime()) / 1000)
      : 0;

    return {
      resumed: true,
      state,
      entries,
      message: `Resumed session ${sessionId}: ${completedCount} steps completed, ${pendingCount} pending approvals, running for ${elapsed}s.`,
    };
  }
}

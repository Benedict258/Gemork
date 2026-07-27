import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ApprovalRequestEvent,
  ApprovalResponseMessage,
  GoalSubmittedMessage,
  InboxItem,
  InboxStats,
  OrchestratorEvent,
  Plan,
  PlanStep,
} from "../types";

type ConnectionState = "disconnected" | "connected" | "reconnecting";

interface UseOrchestratorReturn {
  connected: ConnectionState;
  plans: Plan[];
  currentPlan: Plan | null;
  pendingApproval: ApprovalRequestEvent | null;
  inboxItems: InboxItem[];
  inboxCurrentItem: InboxItem | null;
  inboxStats: InboxStats;
  send: (msg: unknown) => void;
  submitGoal: (goalText: string) => void;
  approveStep: () => void;
  rejectStep: (reason?: string) => void;
  resolveInboxItem: (id: string, response?: unknown) => void;
  cancelInboxItem: (id: string) => void;
  refreshInbox: () => void;
  reconnect: () => void;
}

const WS_URL_FALLBACK = "ws://localhost:8081";
const API_URL_FALLBACK = "http://localhost:3001";
const RECONNECT_DELAY = 3000;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
    return await tauriInvoke<T>(cmd, args);
  } catch {
    throw new Error("Tauri IPC not available - running in browser mode");
  }
}

async function getWsUrl(): Promise<string> {
  try {
    return await invoke<string>("get_ws_url");
  } catch {
    return WS_URL_FALLBACK;
  }
}

async function getApiUrl(): Promise<string> {
  try {
    return await invoke<string>("get_api_url");
  } catch {
    return API_URL_FALLBACK;
  }
}

async function getApiKey(): Promise<string> {
  try {
    return await invoke<string>("get_api_key");
  } catch {
    // Fallback: try reading from localStorage in browser mode
    if (typeof localStorage !== "undefined") {
      return localStorage.getItem("gemork_api_key") || "";
    }
    return "";
  }
}

export function useOrchestrator(): UseOrchestratorReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  const reconnectAttempt = useRef(0);

  const [connected, setConnected] = useState<ConnectionState>("disconnected");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [currentPlan, setCurrentPlan] = useState<Plan | null>(null);
  const [pendingApproval, setPendingApproval] =
    useState<ApprovalRequestEvent | null>(null);
  const [inboxItems, setInboxItems] = useState<InboxItem[]>([]);
  const [inboxCurrentItem, setInboxCurrentItem] = useState<InboxItem | null>(null);
  const [inboxStats, setInboxStats] = useState<InboxStats>({ pending: 0, resolved: 0, cancelled: 0 });

  const handleEvent = useCallback((event: OrchestratorEvent) => {
    switch (event.type) {
      case "plan:created": {
        if (event.plan) {
          setPlans((prev) => [...prev, event.plan!]);
          setCurrentPlan(event.plan);
        }
        break;
      }
      case "plan:updated": {
        if (event.plan) {
          const updated = event.plan;
          setPlans((prev) =>
            prev.map((p) => (p.id === updated.id ? updated : p)),
          );
          setCurrentPlan((prev) =>
            prev?.id === updated.id ? updated : prev,
          );
        }
        break;
      }
      case "plan:completed": {
        if (event.plan) {
          const completed = event.plan;
          setPlans((prev) =>
            prev.map((p) => (p.id === completed.id ? completed : p)),
          );
          setCurrentPlan((prev) =>
            prev?.id === completed.id ? completed : prev,
          );
        }
        break;
      }
      case "step:started": {
        if (event.planId && event.step) {
          updateStepInPlans(event.planId, event.step);
        }
        break;
      }
      case "step:completed": {
        if (event.planId && event.step) {
          updateStepInPlans(event.planId, event.step);
        }
        break;
      }
      case "step:failed": {
        if (event.planId && event.step) {
          updateStepInPlans(event.planId, event.step);
        }
        break;
      }
      case "approval:request": {
        setPendingApproval(event as ApprovalRequestEvent);
        break;
      }
      case "approval:granted":
      case "approval:rejected": {
        setPendingApproval(null);
        break;
      }
    }
  }, []);

  const updateStepInPlans = useCallback(
    (planId: string, updatedStep: PlanStep) => {
      const updater = (plan: Plan): Plan => {
        if (plan.id !== planId) return plan;
        return {
          ...plan,
          steps: plan.steps.map((s) =>
            s.id === updatedStep.id ? updatedStep : s,
          ),
        };
      };
      setPlans((prev) => prev.map(updater));
      setCurrentPlan((prev) => (prev ? updater(prev) : null));
    },
    [],
  );

  const connect = useCallback(() => {
    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    setConnected("reconnecting");

    Promise.all([getWsUrl(), getApiKey()]).then(([wsUrl, key]) => {
      const url = key ? `${wsUrl}?key=${encodeURIComponent(key)}` : wsUrl;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected("connected");
        reconnectAttempt.current = 0;
      };

      ws.onmessage = (msg) => {
        try {
          const event: OrchestratorEvent = JSON.parse(msg.data);
          handleEvent(event);
        } catch {
          console.warn("[WS] Failed to parse message:", msg.data);
        }
      };

      ws.onclose = () => {
        setConnected("disconnected");
        wsRef.current = null;
        scheduleReconnect();
      };

      ws.onerror = () => {
        ws.close();
      };
    });
  }, [handleEvent]);

  const scheduleReconnect = useCallback(() => {
    clearTimeout(reconnectTimer.current);
    reconnectTimer.current = setTimeout(() => {
      reconnectAttempt.current++;
      setConnected("reconnecting");
      connect();
    }, RECONNECT_DELAY);
  }, [connect]);

  const disconnect = useCallback(() => {
    clearTimeout(reconnectTimer.current);
    reconnectAttempt.current = 0;
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnected("disconnected");
  }, []);

  const reconnect = useCallback(() => {
    disconnect();
    setTimeout(connect, 100);
  }, [connect, disconnect]);

  const send = useCallback((msg: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const submitGoal = useCallback(
    async (goalText: string) => {
      try {
        await invoke("submit_goal", { goalText });
      } catch {
        const msg: GoalSubmittedMessage = {
          type: "goal:submitted",
          goalText,
        };
        send(msg);
      }
    },
    [send],
  );

  const approveStep = useCallback(async () => {
    if (!pendingApproval) return;
    try {
      await invoke("approve_step", {
        planId: pendingApproval.planId,
        stepId: pendingApproval.step.id,
      });
    } catch {
      const msg: ApprovalResponseMessage = {
        type: "approval:response",
        planId: pendingApproval.planId,
        stepId: pendingApproval.step.id,
        approved: true,
      };
      send(msg);
    }
    setPendingApproval(null);
  }, [send, pendingApproval]);

  const rejectStep = useCallback(
    async (reason?: string) => {
      if (!pendingApproval) return;
      try {
        await invoke("reject_step", {
          planId: pendingApproval.planId,
          stepId: pendingApproval.step.id,
          reason: reason ?? null,
        });
      } catch {
        const msg: ApprovalResponseMessage = {
          type: "approval:response",
          planId: pendingApproval.planId,
          stepId: pendingApproval.step.id,
          approved: false,
          reason,
        };
        send(msg);
      }
      setPendingApproval(null);
    },
    [send, pendingApproval],
  );

  const refreshInbox = useCallback(async () => {
    try {
      const apiUrl = await getApiUrl();
      const [itemsRes, statsRes] = await Promise.all([
        fetch(`${apiUrl}/api/inbox`),
        fetch(`${apiUrl}/api/inbox/stats`),
      ]);
      if (itemsRes.ok) {
        const data = await itemsRes.json();
        setInboxItems(data.items ?? []);
        setInboxCurrentItem(data.currentItem ?? null);
      }
      if (statsRes.ok) {
        setInboxStats(await statsRes.json());
      }
    } catch {
      // Not critical — inbox endpoints may not be available yet
    }
  }, []);

  const resolveInboxItem = useCallback(
    async (id: string, response?: unknown) => {
      try {
        const apiUrl = await getApiUrl();
        await fetch(`${apiUrl}/api/inbox/${id}/resolve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ response }),
        });
        refreshInbox();
      } catch {
        console.warn("[useOrchestrator] Failed to resolve inbox item via API");
      }
    },
    [refreshInbox],
  );

  const cancelInboxItem = useCallback(
    async (id: string) => {
      try {
        const apiUrl = await getApiUrl();
        await fetch(`${apiUrl}/api/inbox/${id}/cancel`, { method: "POST" });
        refreshInbox();
      } catch {
        console.warn("[useOrchestrator] Failed to cancel inbox item via API");
      }
    },
    [refreshInbox],
  );

  useEffect(() => {
    connect();
    refreshInbox();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect, refreshInbox]);

  return {
    connected,
    plans,
    currentPlan,
    pendingApproval,
    inboxItems,
    inboxCurrentItem,
    inboxStats,
    send,
    submitGoal,
    approveStep,
    rejectStep,
    resolveInboxItem,
    cancelInboxItem,
    refreshInbox,
    reconnect,
  };
}

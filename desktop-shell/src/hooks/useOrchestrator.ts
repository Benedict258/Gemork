import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ApprovalRequestEvent,
  ApprovalResponseMessage,
  GoalSubmittedMessage,
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
  send: (msg: unknown) => void;
  submitGoal: (goalText: string) => void;
  approveStep: () => void;
  rejectStep: (reason?: string) => void;
  reconnect: () => void;
}

const WS_URL = "ws://localhost:8080";
const RECONNECT_DELAY = 3000;

export function useOrchestrator(): UseOrchestratorReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  const reconnectAttempt = useRef(0);

  const [connected, setConnected] = useState<ConnectionState>("disconnected");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [currentPlan, setCurrentPlan] = useState<Plan | null>(null);
  const [pendingApproval, setPendingApproval] =
    useState<ApprovalRequestEvent | null>(null);

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
    const ws = new WebSocket(WS_URL);
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
    (goalText: string) => {
      const msg: GoalSubmittedMessage = {
        type: "goal:submitted",
        goalText,
      };
      send(msg);
    },
    [send],
  );

  const approveStep = useCallback(() => {
    if (!pendingApproval) return;
    const msg: ApprovalResponseMessage = {
      type: "approval:response",
      planId: pendingApproval.planId,
      stepId: pendingApproval.step.id,
      approved: true,
    };
    send(msg);
    setPendingApproval(null);
  }, [send, pendingApproval]);

  const rejectStep = useCallback(
    (reason?: string) => {
      if (!pendingApproval) return;
      const msg: ApprovalResponseMessage = {
        type: "approval:response",
        planId: pendingApproval.planId,
        stepId: pendingApproval.step.id,
        approved: false,
        reason,
      };
      send(msg);
      setPendingApproval(null);
    },
    [send, pendingApproval],
  );

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return {
    connected,
    plans,
    currentPlan,
    pendingApproval,
    send,
    submitGoal,
    approveStep,
    rejectStep,
    reconnect,
  };
}

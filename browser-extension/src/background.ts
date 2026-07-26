import type { OrchestratorMessage } from "./types.js";

const ORCHESTRATOR_WS = "ws://localhost:8080";

let ws: WebSocket | null = null;

function connectToOrchestrator(): void {
  ws = new WebSocket(ORCHESTRATOR_WS);

  ws.onopen = () => {
    console.log("[Gemork] Connected to Local Orchestrator");
  };

  ws.onmessage = (event) => {
    try {
      const message: OrchestratorMessage = JSON.parse(event.data);
      handleMessage(message);
    } catch (e) {
      console.error("[Gemork] Failed to parse message:", e);
    }
  };

  ws.onclose = () => {
    console.log("[Gemork] Disconnected from orchestrator, reconnecting in 3s...");
    setTimeout(connectToOrchestrator, 3000);
  };

  ws.onerror = (e) => {
    console.error("[Gemork] WebSocket error:", e);
  };
}

function handleMessage(message: OrchestratorMessage): void {
  switch (message.type) {
    case "plan:update":
      console.log("[Gemork] Plan updated:", message.data.id);
      break;
    case "step:update":
      console.log("[Gemork] Step updated:", message.data.id, message.data.status);
      break;
    case "approval:request":
      console.log("[Gemork] Approval requested:", message.data.description);
      chrome.notifications?.create({
        type: "basic",
        title: "Gemork Approval Needed",
        message: message.data.description,
      });
      break;
  }
}

chrome.runtime.onInstalled.addListener(() => {
  console.log("[Gemork] Extension installed");
  connectToOrchestrator();
});

chrome.runtime.onStartup.addListener(() => {
  connectToOrchestrator();
});

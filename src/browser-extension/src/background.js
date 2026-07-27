const MessageType = {
  AGENT_UPDATE: 'agent_update',
  TOOL_CALL: 'tool_call',
  TOOL_RESULT: 'tool_result',
  MODE_SWITCH: 'mode_switch',
  PAGE_CONTENT: 'page_content',
  USER_MESSAGE: 'user_message',
  STATUS: 'status',
};

let currentMode = 'ask';
let ws = null;
let reconnectTimer = null;
let apiKey = '';
const WS_URL = 'ws://localhost:8081';

function connectToOrchestrator() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  if (!apiKey) {
    console.log('[Gemork] No API key configured — waiting for user to set one');
    return;
  }

  ws = new WebSocket(`${WS_URL}?key=${encodeURIComponent(apiKey)}`);

  ws.onopen = () => {
    console.log('[Gemork] Connected to orchestrator');
    chrome.storage.local.set({ connected: true });
    broadcast({ type: MessageType.STATUS, connected: true, mode: currentMode });
    sendToOrchestrator({ type: MessageType.MODE_SWITCH, mode: currentMode });
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleOrchestratorMessage(msg);
    } catch (e) {
      console.error('[Gemork] Failed to parse message:', e);
    }
  };

  ws.onclose = () => {
    console.log('[Gemork] Disconnected from orchestrator');
    chrome.storage.local.set({ connected: false });
    broadcast({ type: MessageType.STATUS, connected: false, mode: currentMode });
    scheduleReconnect();
  };

  ws.onerror = (err) => {
    console.error('[Gemork] WebSocket error:', err);
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectToOrchestrator();
  }, 3000);
}

function sendToOrchestrator(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcast(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

function broadcastToTabs(msg) {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
      }
    }
  });
}

async function handleOrchestratorMessage(msg) {
  switch (msg.type) {
    case MessageType.MODE_SWITCH:
      currentMode = msg.mode || 'ask';
      chrome.storage.local.set({ mode: currentMode });
      broadcastToTabs({ type: MessageType.MODE_SWITCH, mode: currentMode });
      broadcast({ type: MessageType.STATUS, connected: true, mode: currentMode });
      break;

    case MessageType.TOOL_CALL: {
      const { tool, args } = msg;
      if (!isToolAllowed(tool, currentMode)) {
        sendToOrchestrator({
          type: MessageType.TOOL_RESULT,
          id: msg.id,
          error: `Tool "${tool}" not allowed in ${currentMode} mode`,
        });
        return;
      }
      try {
        const result = await executeToolOnPage(tool, args);
        sendToOrchestrator({ type: MessageType.TOOL_RESULT, id: msg.id, result });
      } catch (e) {
        sendToOrchestrator({ type: MessageType.TOOL_RESULT, id: msg.id, error: e.message });
      }
      break;
    }

    case MessageType.AGENT_UPDATE:
    case MessageType.STATUS:
      broadcast(msg);
      break;

    default:
      broadcast(msg);
  }
}

async function executeToolOnPage(tool, args) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab');

  console.log(`[Gemork] Tool "${tool}" on tab ${tab.id} (${tab.url || 'unknown'})`);

  if (CREDENTIAL_SENSITIVE_TOOLS.includes(tool) && args?.refId !== undefined) {
    try {
      const checkResult = await chrome.tabs.sendMessage(tab.id, {
        type: MessageType.TOOL_CALL,
        tool: 'get_interactive_elements',
        args: {},
      });
      if (checkResult?.elements) {
        const target = checkResult.elements.find(el => el.refId === args.refId);
        if (target?.credentialField) {
          console.warn(`[Gemork] BLOCKED ${tool} on credential field (${target.credentialField}) in background`);
          return {
            blocked: true,
            reason: `Security: cannot ${tool} on credential field (${target.credentialField})`,
            refId: args.refId,
          };
        }
      }
    } catch {
      // If check fails, content.js will handle the block
    }
  }

  const response = await chrome.tabs.sendMessage(tab.id, {
    type: MessageType.TOOL_CALL,
    tool,
    args,
  });
  return response;
}

async function getUserMessage(text) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const pageContent = tab?.id ? await chrome.tabs.sendMessage(tab.id, { type: MessageType.PAGE_CONTENT }).catch(() => null) : null;

  const context = pageContent
    ? { url: pageContent.url, title: pageContent.title, adapter: pageContent.adapter || 'generic' }
    : undefined;

  sendToOrchestrator({
    type: MessageType.USER_MESSAGE,
    message: text,
    context,
  });
}

function isToolAllowed(toolName, mode) {
  const ASK_TOOLS = ['read_page', 'extract_data', 'get_interactive_elements', 'scroll'];
  const ACT_TOOLS = [...ASK_TOOLS, 'click', 'type', 'navigate', 'submit_form'];
  return mode === 'act' ? ACT_TOOLS.includes(toolName) : ASK_TOOLS.includes(toolName);
}

const CREDENTIAL_SENSITIVE_TOOLS = ['click', 'type'];

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === MessageType.USER_MESSAGE) {
    getUserMessage(msg.message);
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === MessageType.MODE_SWITCH) {
    currentMode = msg.mode;
    chrome.storage.local.set({ mode: currentMode });
    sendToOrchestrator({ type: MessageType.MODE_SWITCH, mode: currentMode });
    broadcastToTabs({ type: MessageType.MODE_SWITCH, mode: currentMode });
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === MessageType.STATUS) {
    sendResponse({ connected: ws?.readyState === WebSocket.OPEN, mode: currentMode });
    return true;
  }

  if (msg.type === 'page_content') {
    executeToolOnPage('read_page', {}).then(sendResponse);
    return true;
  }

  if (msg.type === 'set_api_key') {
    apiKey = msg.apiKey || '';
    chrome.storage.local.set({ apiKey });
    // Reconnect with new key
    if (ws) {
      ws.close();
    }
    setTimeout(connectToOrchestrator, 500);
    sendResponse({ ok: true });
    return true;
  }

  return false;
});

chrome.storage.local.get(['mode', 'apiKey'], (data) => {
  currentMode = data.mode || 'ask';
  apiKey = data.apiKey || '';
  connectToOrchestrator();
});

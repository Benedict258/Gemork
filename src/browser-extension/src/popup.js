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
let connected = false;

const askBtn = document.getElementById('askBtn');
const actBtn = document.getElementById('actBtn');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const modeLabel = document.getElementById('modeLabel');
const responses = document.getElementById('responses');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');

function updateUI() {
  askBtn.className = 'mode-btn' + (currentMode === 'ask' ? ' active-ask' : '');
  actBtn.className = 'mode-btn' + (currentMode === 'act' ? ' active-act' : '');
  statusDot.className = 'status-dot' + (connected ? ' connected' : '');
  statusText.textContent = connected ? 'Connected' : 'Disconnected';
  modeLabel.textContent = currentMode === 'ask'
    ? 'Ask mode — read-only access'
    : 'Act mode — can interact with pages';
}

function appendResponse(text, type = 'agent') {
  const div = document.createElement('div');
  div.className = `response ${type}`;
  div.textContent = text;
  responses.appendChild(div);
  responses.scrollTop = responses.scrollHeight;
}

askBtn.addEventListener('click', () => {
  currentMode = 'ask';
  chrome.runtime.sendMessage({ type: MessageType.MODE_SWITCH, mode: 'ask' });
  updateUI();
});

actBtn.addEventListener('click', () => {
  currentMode = 'act';
  chrome.runtime.sendMessage({ type: MessageType.MODE_SWITCH, mode: 'act' });
  updateUI();
});

sendBtn.addEventListener('click', send);
userInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') send();
});

function send() {
  const text = userInput.value.trim();
  if (!text) return;
  appendResponse(`You: ${text}`, 'user');
  userInput.value = '';
  chrome.runtime.sendMessage({ type: MessageType.USER_MESSAGE, message: text });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === MessageType.STATUS) {
    connected = msg.connected;
    currentMode = msg.mode || currentMode;
    updateUI();
  }

  if (msg.type === MessageType.AGENT_UPDATE) {
    appendResponse(msg.text || JSON.stringify(msg));
  }

  if (msg.type === MessageType.MODE_SWITCH) {
    currentMode = msg.mode;
    updateUI();
  }
});

chrome.storage.local.get(['mode', 'connected'], (data) => {
  if (data.mode) currentMode = data.mode;
  if (typeof data.connected === 'boolean') connected = data.connected;
  updateUI();
});

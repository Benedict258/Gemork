export const Mode = Object.freeze({
  ASK: 'ask',
  ACT: 'act',
});

export const MessageType = Object.freeze({
  AGENT_UPDATE: 'agent_update',
  TOOL_CALL: 'tool_call',
  TOOL_RESULT: 'tool_result',
  MODE_SWITCH: 'mode_switch',
  PAGE_CONTENT: 'page_content',
  USER_MESSAGE: 'user_message',
  STATUS: 'status',
});

export const ASK_TOOLS = Object.freeze([
  'read_page',
  'extract_data',
  'get_interactive_elements',
  'scroll',
]);

export const ACT_TOOLS = Object.freeze([
  ...ASK_TOOLS,
  'click',
  'type',
  'navigate',
  'submit_form',
]);

export function getToolsForMode(mode) {
  return mode === Mode.ACT ? ACT_TOOLS : ASK_TOOLS;
}

export function isToolAllowed(toolName, mode) {
  const allowed = getToolsForMode(mode);
  return allowed.includes(toolName);
}

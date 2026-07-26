const Mode = {
  ASK: 'ask',
  ACT: 'act',
};

const ASK_TOOLS = ['read_page', 'extract_data', 'get_interactive_elements', 'scroll'];
const ACT_TOOLS = [...ASK_TOOLS, 'click', 'type', 'navigate', 'submit_form'];

function getToolsForMode(mode) {
  return mode === Mode.ACT ? ACT_TOOLS : ASK_TOOLS;
}

function isToolAllowed(toolName, mode) {
  return getToolsForMode(mode).includes(toolName);
}

function validateToolCall(toolCall, mode) {
  const { tool } = toolCall;
  if (!isToolAllowed(tool, mode)) {
    return {
      allowed: false,
      error: `Tool "${tool}" is not available in ${mode} mode. Available tools: ${getToolsForMode(mode).join(', ')}`,
    };
  }
  return { allowed: true };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Mode, ASK_TOOLS, ACT_TOOLS, getToolsForMode, isToolAllowed, validateToolCall };
}

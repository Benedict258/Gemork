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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === MessageType.MODE_SWITCH) {
    currentMode = msg.mode;
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === MessageType.TOOL_CALL) {
    handleToolCall(msg.tool, msg.args).then(sendResponse);
    return true;
  }

  if (msg.type === MessageType.PAGE_CONTENT) {
    readPageContent().then(sendResponse);
    return true;
  }
});

function getRefId(el, counter) {
  if (!el._gemorkRefId) {
    el._gemorkRefId = counter.value++;
  }
  return el._gemorkRefId;
}

function getInteractiveElements() {
  const counter = { value: 1 };
  const selectors = [
    'a[href]', 'button', 'input', 'textarea', 'select',
    '[role="button"]', '[role="link"]', '[role="tab"]',
    '[role="menuitem"]', '[onclick]', 'details > summary',
  ];
  const elements = document.querySelectorAll(selectors.join(','));
  return Array.from(elements).map(el => {
    const refId = getRefId(el, counter);
    const rect = el.getBoundingClientRect();
    return {
      refId,
      tag: el.tagName.toLowerCase(),
      type: el.type || null,
      text: (el.textContent || '').trim().slice(0, 100),
      ariaLabel: el.getAttribute('aria-label') || null,
      href: el.href || null,
      placeholder: el.placeholder || null,
      value: el.value || null,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
  });
}

async function readPageContent() {
  const elements = getInteractiveElements();
  const text = document.body.innerText.slice(0, 50000);
  const links = Array.from(document.querySelectorAll('a[href]')).map(a => ({
    text: (a.textContent || '').trim().slice(0, 200),
    href: a.href,
  }));
  const forms = Array.from(document.querySelectorAll('form')).map(f => ({
    action: f.action,
    method: f.method,
    fields: Array.from(f.querySelectorAll('input,textarea,select')).map(i => ({
      name: i.name,
      type: i.type,
      placeholder: i.placeholder,
      value: i.value,
    })),
  }));
  return {
    url: location.href,
    title: document.title,
    text,
    links: links.slice(0, 100),
    forms,
    interactiveElements: elements,
  };
}

function findElementByRefId(refId) {
  const counter = { value: 1 };
  const selectors = [
    'a[href]', 'button', 'input', 'textarea', 'select',
    '[role="button"]', '[role="link"]', '[role="tab"]',
    '[role="menuitem"]', '[onclick]', 'details > summary',
  ];
  const elements = document.querySelectorAll(selectors.join(','));
  for (const el of elements) {
    const id = getRefId(el, counter);
    if (id === refId) return el;
  }
  return null;
}

function simulateClick(el) {
  el.focus();
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

function simulateType(el, text) {
  el.focus();
  el.value = '';
  for (const char of text) {
    el.value += char;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: char }));
  }
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function simulateScroll(direction, amount) {
  window.scrollBy(0, direction === 'down' ? amount : -amount);
}

function simulateSubmit(formEl) {
  if (formEl) formEl.submit();
}

async function handleToolCall(tool, args) {
  switch (tool) {
    case 'read_page':
      return readPageContent();
    case 'get_interactive_elements':
      return { elements: getInteractiveElements() };
    case 'extract_data':
      return extractData(args.selector || null);
    case 'scroll':
      simulateScroll(args.direction || 'down', args.amount || 500);
      return { scrolled: true, direction: args.direction || 'down' };
    case 'click': {
      const el = findElementByRefId(args.refId);
      if (!el) return { error: `Element refId ${args.refId} not found` };
      simulateClick(el);
      return { clicked: true, refId: args.refId };
    }
    case 'type': {
      const el = findElementByRefId(args.refId);
      if (!el) return { error: `Element refId ${args.refId} not found` };
      simulateType(el, args.text || '');
      return { typed: true, refId: args.refId };
    }
    case 'navigate':
      window.location.href = args.url;
      return { navigating: true, url: args.url };
    case 'submit_form': {
      let formEl = null;
      if (args.refId) {
        const el = findElementByRefId(args.refId);
        if (el) formEl = el.closest('form');
      } else if (args.formIndex !== undefined) {
        formEl = document.querySelectorAll('form')[args.formIndex];
      }
      simulateSubmit(formEl);
      return { submitted: true };
    }
    default:
      return { error: `Unknown tool: ${tool}` };
  }
}

function extractData(selector) {
  if (!selector) {
    return {
      text: document.body.innerText.slice(0, 10000),
      html: document.body.innerHTML.slice(0, 10000),
    };
  }
  try {
    const els = document.querySelectorAll(selector);
    return { results: Array.from(els).map(el => el.textContent.trim()) };
  } catch (e) {
    return { error: `Invalid selector: ${e.message}` };
  }
}

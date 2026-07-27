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

let credentialDetector = null;

function getCredentialDetector() {
  if (credentialDetector) return credentialDetector;
  if (window.GemorkCredentialDetector) {
    credentialDetector = window.GemorkCredentialDetector;
    return credentialDetector;
  }
  credentialDetector = {
    isCredentialField: () => false,
    getCredentialType: () => null,
    scanPageForCredentials: () => [],
  };
  return credentialDetector;
}

function initAdapters() {
  if (typeof AdapterRegistry === 'undefined') {
    console.warn('[Gemork] AdapterRegistry not found');
    return;
  }
  if (typeof GenericAdapter !== 'undefined') AdapterRegistry.registerAdapter(GenericAdapter);
  if (typeof GitHubAdapter !== 'undefined') AdapterRegistry.registerAdapter(GitHubAdapter);
  if (typeof GoogleAdapter !== 'undefined') AdapterRegistry.registerAdapter(GoogleAdapter);
  if (typeof NotionAdapter !== 'undefined') AdapterRegistry.registerAdapter(NotionAdapter);
  if (typeof SlackAdapter !== 'undefined') AdapterRegistry.registerAdapter(SlackAdapter);
  if (typeof DocsAdapter !== 'undefined') AdapterRegistry.registerAdapter(DocsAdapter);
  console.log('[Gemork] Adapters loaded:', AdapterRegistry.listAdapters().map(a => a.name));
}

function getActiveAdapter() {
  if (typeof AdapterRegistry === 'undefined') return null;
  return AdapterRegistry.getAdapter(window.location.href);
}

function getFallbackAdapter() {
  return (typeof GenericAdapter !== 'undefined') ? GenericAdapter : null;
}

initAdapters();

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
  const adapter = getActiveAdapter();
  if (adapter && adapter.getInteractiveElements) {
    const elements = adapter.getInteractiveElements(document);
    const detector = getCredentialDetector();
    return elements.map(el => {
      const credType = detector.getCredentialType(el);
      return { ...el, credentialField: credType || undefined };
    });
  }

  const counter = { value: 1 };
  const selectors = [
    'a[href]', 'button', 'input', 'textarea', 'select',
    '[role="button"]', '[role="link"]', '[role="tab"]',
    '[role="menuitem"]', '[onclick]', 'details > summary',
  ];
  const elements = document.querySelectorAll(selectors.join(','));
  const detector = getCredentialDetector();
  return Array.from(elements).map(el => {
    const refId = getRefId(el, counter);
    const rect = el.getBoundingClientRect();
    const credType = detector.getCredentialType(el);
    return {
      refId,
      tag: el.tagName.toLowerCase(),
      type: el.type || null,
      text: (el.textContent || '').trim().slice(0, 100),
      ariaLabel: el.getAttribute('aria-label') || null,
      href: el.href || null,
      placeholder: el.placeholder || null,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      credentialField: credType || undefined,
    };
  });
}

async function readPageContent() {
  const adapter = getActiveAdapter();
  const adapterName = adapter ? adapter.name : 'generic';
  const fallback = getFallbackAdapter();

  let pageData;
  if (adapter && adapter.readPage) {
    pageData = adapter.readPage(document);
  } else if (fallback && fallback.readPage) {
    pageData = fallback.readPage(document);
  } else {
    pageData = { text: document.body ? document.body.innerText.slice(0, 50000) : '' };
  }

  const elements = getInteractiveElements();
  const detector = getCredentialDetector();
  const credentialFields = detector.scanPageForCredentials().map(c => ({
    type: c.type,
    tag: c.tag,
    name: c.name,
    id: c.id,
    inputType: c.inputType,
  }));

  return {
    url: location.href,
    title: document.title,
    adapter: adapterName,
    text: pageData.text || '',
    pageData,
    interactiveElements: elements,
    credentialFields,
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

function findElementBySelector(target) {
  const adapter = getActiveAdapter();
  const fallback = getFallbackAdapter();
  const doc = document;

  if (adapter && adapter.clickSelector) {
    const el = adapter.clickSelector(doc, target);
    if (el) return el;
  }
  if (fallback && fallback.clickSelector) {
    const el = fallback.clickSelector(doc, target);
    if (el) return el;
  }
  return null;
}

function findInputBySelector(target) {
  const adapter = getActiveAdapter();
  const fallback = getFallbackAdapter();
  const doc = document;

  if (adapter && adapter.typeSelector) {
    const el = adapter.typeSelector(doc, target);
    if (el) return el;
  }
  if (fallback && fallback.typeSelector) {
    const el = fallback.typeSelector(doc, target);
    if (el) return el;
  }
  return null;
}

function simulateClick(el) {
  el.focus();
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

function simulateType(el, text) {
  el.focus();
  if (el.getAttribute('contenteditable') === 'true') {
    el.textContent = text;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
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
  const detector = getCredentialDetector();

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
      let el = null;
      if (args.refId) {
        el = findElementByRefId(args.refId);
      } else if (args.target) {
        el = findElementBySelector(args.target);
      }
      if (!el) return { error: `Element not found: refId=${args.refId || 'none'}, target=${args.target || 'none'}` };
      if (detector.isCredentialField(el)) {
        const credType = detector.getCredentialType(el);
        console.warn(`[Gemork] BLOCKED click on credential field (${credType}). refId=${args.refId}`);
        return { blocked: true, reason: `Cannot interact with credential field: ${credType}`, refId: args.refId };
      }
      simulateClick(el);
      return { clicked: true, refId: args.refId };
    }
    case 'type': {
      let el = null;
      if (args.refId) {
        el = findElementByRefId(args.refId);
      } else if (args.target) {
        el = findInputBySelector(args.target);
      }
      if (!el) return { error: `Input not found: refId=${args.refId || 'none'}, target=${args.target || 'none'}` };
      if (detector.isCredentialField(el)) {
        const credType = detector.getCredentialType(el);
        console.warn(`[Gemork] BLOCKED type on credential field (${credType}). refId=${args.refId}`);
        return { blocked: true, reason: `Cannot interact with credential field: ${credType}`, refId: args.refId };
      }
      simulateType(el, args.text || '');
      return { typed: true, refId: args.refId };
    }
    case 'navigate': {
      // Validate URL scheme — block javascript:, data:, file: URIs
      const url = args.url || '';
      const blockedSchemes = ['javascript:', 'data:', 'file:', 'vbscript:'];
      if (blockedSchemes.some(s => url.toLowerCase().startsWith(s))) {
        return { blocked: true, reason: `Blocked navigation to ${url.split(':')[0]}: scheme` };
      }
      // Only allow http/https
      if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
        return { blocked: true, reason: 'Only http/https URLs are allowed' };
      }
      window.location.href = url;
      return { navigating: true, url };
    }
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

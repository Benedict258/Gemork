const DocsAdapter = (() => {
  function readPage(doc) {
    const result = { type: 'unknown', content: {} };

    const document = doc.querySelector('.kix-page, .kix-page-content-wrapper, .kix-appview-editor');
    if (document) {
      result.type = 'document';
    }

    const title = doc.querySelector('.docs-title-input, .kix-title-input, [aria-label="Document title"]');
    if (title) {
      result.content.title = title.textContent.trim().slice(0, 500);
    }

    const textContent = doc.querySelector('.kix-page-content-wrapper, .kix-appview-editor');
    if (textContent) {
      result.content.text = (textContent.innerText || textContent.textContent || '').slice(0, 50000);
    }

    const headings = doc.querySelectorAll('.kix-word--heading, [data-heading-level], h1, h2, h3, h4, h5, h6');
    if (headings.length > 0) {
      result.content.headings = Array.from(headings).map(h => ({
        level: parseInt(h.getAttribute('data-heading-level') || h.tagName[1] || '1'),
        text: h.textContent.trim().slice(0, 200),
      }));
    }

    const lists = doc.querySelectorAll('.kix-list, .docs-texteventtarget-iframe');
    if (lists.length > 0) {
      result.content.hasLists = true;
    }

    const comments = doc.querySelectorAll('.doc-comment, .kix-comment-thread, [data-comment-id]');
    if (comments.length > 0) {
      result.content.comments = Array.from(comments).map(c => ({
        author: c.querySelector('.doc-comment-author, .kix-comment-avatar')?.getAttribute('aria-label') || '',
        text: c.querySelector('.doc-comment-body, .kix-comment-content')?.textContent?.trim()?.slice(0, 500) || '',
        resolved: c.classList.contains('resolved') || c.querySelector('.doc-comment-resolved') !== null,
      }));
    }

    const outline = doc.querySelector('.docs-outline, .kix-sidebar, [data-qa="outline"]');
    if (outline) {
      const outlineItems = outline.querySelectorAll('.docs-outline-item, a[href*="heading"]');
      result.content.outline = Array.from(outlineItems).map(item => ({
        text: item.textContent.trim().slice(0, 100),
        level: parseInt(item.getAttribute('data-level') || '1'),
      }));
    }

    const toolbar = doc.querySelector('.docs-toolbar, .kix-toolbar, [role="toolbar"]');
    if (toolbar) {
      result.content.toolbar = {
        buttons: Array.from(toolbar.querySelectorAll('button, [role="button"]')).map(b => ({
          label: b.getAttribute('aria-label') || b.getAttribute('data-tooltip') || b.textContent.trim().slice(0, 50),
          active: b.classList.contains('active') || b.getAttribute('aria-pressed') === 'true',
        })).filter(b => b.label),
      };
    }

    const rulers = doc.querySelectorAll('.kix-ruler, .docs-ruler');
    if (rulers.length > 0) {
      result.content.hasPageLayout = true;
    }

    result.content.text = result.content.text || (doc.body ? (doc.body.innerText || doc.body.textContent || '').slice(0, 50000) : '');
    return result;
  }

  function getInteractiveElements(doc) {
    const counter = { value: 1 };
    const selectors = [
      '.docs-texteventtarget-iframe',
      '[contenteditable="true"]',
      '.kix-canvas-tile-content',
      'canvas',
      '.docs-toolbar button',
      '.kix-toolbar button',
      '[role="toolbar"] button',
      '[role="button"]',
      '.docs-title-input',
      '.kix-title-input',
      'a[href]',
      'button',
      'input',
      'select',
    ];
    const elements = doc.querySelectorAll(selectors.join(','));
    return Array.from(elements).map(el => {
      const id = counter.value++;
      el._gemorkRefId = id;
      const rect = el.getBoundingClientRect();
      return {
        refId: id,
        tag: el.tagName.toLowerCase(),
        type: el.type || null,
        text: (el.textContent || '').trim().slice(0, 100),
        ariaLabel: el.getAttribute('aria-label') || el.getAttribute('data-tooltip') || null,
        href: el.href || null,
        editable: el.getAttribute('contenteditable') === 'true',
        isCanvas: el.tagName === 'CANVAS',
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      };
    });
  }

  function clickSelector(doc, target) {
    if (typeof target === 'number') {
      return doc.querySelector(`[data-gemork-ref="${target}"]`);
    }
    if (typeof target === 'string') {
      let el = doc.querySelector(target);
      if (el) return el;

      const toolbarBtns = doc.querySelectorAll('.docs-toolbar button, .kix-toolbar button, [role="toolbar"] button');
      for (const btn of toolbarBtns) {
        const label = btn.getAttribute('aria-label') || btn.getAttribute('data-tooltip') || '';
        if (label.toLowerCase().includes(target.toLowerCase())) {
          return btn;
        }
      }

      const menuItems = doc.querySelectorAll('[role="menuitem"], [role="option"]');
      for (const item of menuItems) {
        if (item.textContent.trim().toLowerCase().includes(target.toLowerCase())) {
          return item;
        }
      }
    }
    return null;
  }

  function typeSelector(doc, target) {
    if (typeof target === 'number') {
      return doc.querySelector(`[data-gemork-ref="${target}"]`);
    }
    if (typeof target === 'string') {
      let el = doc.querySelector(target);
      if (el) return el;

      el = doc.querySelector('.docs-texteventtarget-iframe');
      if (el) return el;

      el = doc.querySelector('[contenteditable="true"]');
      if (el) return el;

      el = doc.querySelector('.docs-title-input, .kix-title-input');
      if (el) return el;

      el = doc.querySelector('textarea, input[type="text"]');
      if (el) return el;
    }
    return null;
  }

  return {
    name: 'docs',
    hostPatterns: ['docs.google.com'],
    readPage,
    getInteractiveElements,
    clickSelector,
    typeSelector,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = DocsAdapter;
}

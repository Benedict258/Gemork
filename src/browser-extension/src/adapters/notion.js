const NotionAdapter = (() => {
  function readPage(doc) {
    const result = { type: 'unknown', content: {} };

    const pageContent = doc.querySelector('.notion-page-content, .layout-content, [data-block-id]');
    if (pageContent) {
      result.type = 'page';
    }

    const blocks = doc.querySelectorAll('[data-block-id]');
    if (blocks.length > 0) {
      result.content.blocks = Array.from(blocks).map(block => {
        const blockId = block.getAttribute('data-block-id');
        const text = block.innerText.trim().slice(0, 2000);
        const type = block.getAttribute('data-block-type') || detectBlockType(block);
        const children = block.querySelectorAll('[data-block-id]');
        return {
          id: blockId,
          type,
          text,
          childCount: children.length,
          level: getBlockLevel(block),
        };
      }).filter(b => b.text.length > 0);
    }

    const title = doc.querySelector('.notion-page-block, .notion-selectionable-block, h1, [data-placeholder="Untitled"]');
    if (title) {
      result.content.title = title.textContent.trim().slice(0, 500);
    }

    const sidebar = doc.querySelector('.notion-sidebar, .notion-overlay-container, [class*="sidebar"]');
    if (sidebar) {
      const navItems = sidebar.querySelectorAll('a[href], [role="treeitem"], .notion-sidebar-item');
      result.content.sidebar = Array.from(navItems).map(item => ({
        text: item.textContent.trim().slice(0, 100),
        href: item.href || item.getAttribute('data-href') || '',
        active: item.classList.contains('active') || item.getAttribute('aria-selected') === 'true',
      })).filter(item => item.text);
    }

    const databases = doc.querySelectorAll('.notion-table-view, .notion-board-view, .notion-gallery-view, [data-block-type="collection_view"]');
    if (databases.length > 0) {
      result.content.databases = Array.from(databases).map(db => {
        const title = db.querySelector('.notion-collection-view-title, [data-block-id] .notion-focusable')?.textContent?.trim() || '';
        const rows = db.querySelectorAll('.notion-collection-item, .notion-table-row, [role="row"]');
        return {
          title,
          rowCount: rows.length,
          type: db.classList.contains('notion-board-view') ? 'board' :
                db.classList.contains('notion-gallery-view') ? 'gallery' : 'table',
        };
      });
      result.type = result.type === 'page' ? 'page' : 'database';
    }

    const toggles = doc.querySelectorAll('details, [data-block-type="toggle"]');
    if (toggles.length > 0) {
      result.content.toggles = Array.from(toggles).map(toggle => ({
        summary: (toggle.querySelector('summary, [data-block-id]')?.textContent || '').trim().slice(0, 200),
        open: toggle.open || toggle.classList.contains('open'),
        content: toggle.querySelector('.notion-page-content, .layout-content')?.innerText?.trim()?.slice(0, 500) || '',
      }));
    }

    const breadcrumbs = doc.querySelectorAll('.notion-topbar, [class*="breadcrumb"] a, .notion-frame');
    if (breadcrumbs.length > 0) {
      result.content.breadcrumbs = Array.from(breadcrumbs).map(b => b.textContent.trim().slice(0, 100));
    }

    result.content.text = doc.body ? doc.body.innerText.slice(0, 50000) : '';
    return result;
  }

  function detectBlockType(block) {
    const classes = block.className || '';
    if (classes.includes('notion-text-block') || classes.includes('notion-focusable')) return 'text';
    if (classes.includes('notion-heading-block') || classes.includes('notion-selectable')) return 'heading';
    if (classes.includes('notion-list-block')) return 'list';
    if (classes.includes('notion-toggle-block')) return 'toggle';
    if (classes.includes('notion-quote-block')) return 'quote';
    if (classes.includes('notion-callout-block')) return 'callout';
    if (classes.includes('notion-code-block')) return 'code';
    if (classes.includes('notion-divider-block')) return 'divider';
    if (classes.includes('notion-image-block')) return 'image';
    if (classes.includes('notion-bookmark-block')) return 'bookmark';
    if (classes.includes('notion-table-block')) return 'table';
    if (classes.includes('notion-column-block')) return 'column';
    if (classes.includes('notion-synced-block')) return 'synced';
    if (classes.includes('notion-breadcrumb-block')) return 'breadcrumb';
    if (classes.includes('notion-page-block')) return 'page';
    if (classes.includes('notion-collection-block')) return 'collection';
    return 'unknown';
  }

  function getBlockLevel(block) {
    let level = 0;
    let parent = block.parentElement;
    while (parent) {
      if (parent.hasAttribute('data-block-id')) {
        level++;
      }
      parent = parent.parentElement;
    }
    return level;
  }

  function getInteractiveElements(doc) {
    const counter = { value: 1 };
    const selectors = [
      '[data-block-id]',
      'a[href]',
      'button',
      'input:not([type="hidden"])',
      'textarea',
      '[role="button"]',
      '[role="treeitem"]',
      '.notion-selectable',
      '[contenteditable="true"]',
    ];
    const elements = doc.querySelectorAll(selectors.join(','));
    return Array.from(elements).map(el => {
      const id = counter.value++;
      el._gemorkRefId = id;
      const rect = el.getBoundingClientRect();
      const blockId = el.closest('[data-block-id]')?.getAttribute('data-block-id');
      return {
        refId: id,
        tag: el.tagName.toLowerCase(),
        type: el.type || null,
        text: (el.textContent || '').trim().slice(0, 100),
        ariaLabel: el.getAttribute('aria-label') || null,
        href: el.href || null,
        placeholder: el.placeholder || el.getAttribute('data-placeholder') || null,
        blockId,
        editable: el.getAttribute('contenteditable') === 'true',
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

      el = doc.querySelector(`[data-block-id="${target}"]`);
      if (el) return el;

      const blockEls = doc.querySelectorAll('[data-block-id]');
      for (const block of blockEls) {
        if (block.getAttribute('data-block-id') === target) {
          return block;
        }
      }

      const allEls = doc.querySelectorAll('[data-block-id], .notion-selectable, a[href]');
      for (const el of allEls) {
        if (el.textContent.trim().toLowerCase() === target.toLowerCase()) {
          return el;
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

      el = doc.querySelector('[contenteditable="true"]');
      if (el) return el;

      el = doc.querySelector(`[data-block-id="${target}"] [contenteditable="true"]`);
      if (el) return el;

      el = doc.querySelector('textarea, input:not([type="hidden"])');
      if (el) return el;

      const blockEls = doc.querySelectorAll('[data-block-id]');
      for (const block of blockEls) {
        if (block.textContent.trim().toLowerCase().includes(target.toLowerCase())) {
          const editable = block.querySelector('[contenteditable="true"]');
          if (editable) return editable;
        }
      }
    }
    return null;
  }

  return {
    name: 'notion',
    hostPatterns: ['notion.so', 'notion.site'],
    readPage,
    getInteractiveElements,
    clickSelector,
    typeSelector,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = NotionAdapter;
}

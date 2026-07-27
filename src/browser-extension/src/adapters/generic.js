const GenericAdapter = (() => {
  function readPage(doc) {
    const headings = Array.from(doc.querySelectorAll('h1, h2, h3, h4, h5, h6')).map(h => ({
      level: parseInt(h.tagName[1]),
      text: h.textContent.trim().slice(0, 200),
    }));

    const links = Array.from(doc.querySelectorAll('a[href]')).map(a => ({
      text: (a.textContent || '').trim().slice(0, 200),
      href: a.href,
    }));

    const paragraphs = Array.from(doc.querySelectorAll('p')).map(p =>
      p.textContent.trim().slice(0, 500)
    ).filter(t => t.length > 0);

    const lists = Array.from(doc.querySelectorAll('ul, ol')).map(list => {
      const items = Array.from(list.querySelectorAll(':scope > li')).map(li =>
        li.textContent.trim().slice(0, 200)
      );
      return { ordered: list.tagName === 'OL', items };
    }).filter(l => l.items.length > 0);

    const text = doc.body ? doc.body.innerText.slice(0, 50000) : '';

    return {
      headings,
      links: links.slice(0, 100),
      paragraphs: paragraphs.slice(0, 50),
      lists,
      text,
    };
  }

  function getInteractiveElements(doc) {
    const counter = { value: 1 };
    const selectors = [
      'a[href]', 'button', 'input', 'textarea', 'select',
      '[role="button"]', '[role="link"]', '[role="tab"]',
      '[role="menuitem"]', '[onclick]', 'details > summary',
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
        ariaLabel: el.getAttribute('aria-label') || null,
        href: el.href || null,
        placeholder: el.placeholder || null,
        value: el.value || null,
        name: el.name || null,
        id: el.id || null,
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

      el = doc.evaluate(
        `//button[contains(text(), "${target}")] | //a[contains(text(), "${target}")] | //*[@aria-label="${target}"]`,
        doc,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      ).singleNodeValue;
      if (el) return el;

      const allEls = doc.querySelectorAll('button, a, [role="button"], [role="link"]');
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

      el = doc.querySelector(`input[name="${target}"], input[id="${target}"], textarea[name="${target}"], textarea[id="${target}"]`);
      if (el) return el;

      el = doc.querySelector(`input[placeholder="${target}"], textarea[placeholder="${target}"]`);
      if (el) return el;

      const labels = doc.querySelectorAll('label');
      for (const label of labels) {
        if (label.textContent.trim().toLowerCase().includes(target.toLowerCase())) {
          const forId = label.getAttribute('for');
          if (forId) {
            el = doc.getElementById(forId);
            if (el) return el;
          }
          el = label.querySelector('input, textarea');
          if (el) return el;
        }
      }
    }
    return null;
  }

  return { name: 'generic', hostPatterns: [], readPage, getInteractiveElements, clickSelector, typeSelector };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = GenericAdapter;
}

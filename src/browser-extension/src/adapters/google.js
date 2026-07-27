const GoogleAdapter = (() => {
  function readPage(doc) {
    const result = { type: 'unknown', content: {} };

    const searchInput = doc.querySelector('textarea[name="q"], input[name="q"]');
    if (searchInput) {
      result.content.query = searchInput.value;
      result.type = 'search';
    }

    const results = doc.querySelectorAll('.g, [data-hveid], .tF2Cxc');
    if (results.length > 0) {
      result.content.results = Array.from(results).map(r => {
        const linkEl = r.querySelector('a[href]');
        const titleEl = r.querySelector('h3');
        const snippetEl = r.querySelector('.VwiC3b, .IsZvec, [data-sncf], .st');
        const urlEl = r.querySelector('.cite, .iUh30, [data-ved]');
        return {
          title: titleEl?.textContent?.trim()?.slice(0, 200) || '',
          href: linkEl?.href || '',
          snippet: snippetEl?.textContent?.trim()?.slice(0, 500) || '',
          displayUrl: urlEl?.textContent?.trim()?.slice(0, 200) || '',
        };
      }).filter(r => r.title || r.href);
    }

    const knowledgePanel = doc.querySelector('[data-attrid="wa:/description"], [data-kp], .kp-blk, [data-ved] .related-question-pair');
    if (knowledgePanel) {
      result.content.knowledgePanel = {
        title: knowledgePanel.querySelector('h2, .kp-header, [data-attrid="title"]')?.textContent?.trim()?.slice(0, 200) || '',
        description: knowledgePanel.querySelector('.LGOjhe, .r-iYLDNTYQNF9P, [data-attrid="wa:/description"]')?.textContent?.trim()?.slice(0, 1000) || '',
      };
    }

    const featuredSnippet = doc.querySelector('[data-attrid="wa:/snippet"], .kp-blk .LGOjhe, [data-featured-snippet]');
    if (featuredSnippet) {
      result.content.featuredSnippet = featuredSnippet.innerText.slice(0, 2000);
    }

    const relatedSearches = doc.querySelectorAll('[data-ved] .s75CFd a, .brs_col a, [role="listitem"] a');
    if (relatedSearches.length > 0) {
      result.content.relatedSearches = Array.from(relatedSearches).map(a => ({
        text: a.textContent.trim().slice(0, 200),
        href: a.href,
      })).filter(r => r.text);
    }

    const pagination = doc.querySelectorAll('#pnnext, #pnprev, a[aria-label*="Page"], .fl');
    if (pagination.length > 0) {
      result.content.pagination = Array.from(pagination).map(a => ({
        text: a.textContent.trim().slice(0, 50),
        href: a.href,
        type: a.id === 'pnnext' ? 'next' : a.id === 'pnprev' ? 'prev' : 'page',
      }));
    }

    const newsResults = doc.querySelectorAll('.WlydOe, .ftSUBd, [data-nved]');
    if (newsResults.length > 0 && (!result.content.results || result.content.results.length === 0)) {
      result.content.newsResults = Array.from(newsResults).map(r => {
        const link = r.querySelector('a[href]');
        return {
          title: r.querySelector('div[role="heading"]')?.textContent?.trim()?.slice(0, 200) || '',
          href: link?.href || '',
          source: r.querySelector('.OSrXXb, .CEMjEf')?.textContent?.trim() || '',
          time: r.querySelector('.OSrXXb span, .r0bn4c')?.textContent?.trim() || '',
        };
      });
      result.type = 'news';
    }

    const allResults = result.content.results || result.content.newsResults || [];
    if (allResults.length > 0) {
      result.content.text = allResults.map(r => `${r.title}\n${r.href}\n${r.snippet || r.source || ''}`).join('\n\n');
    } else {
      result.content.text = doc.body ? doc.body.innerText.slice(0, 50000) : '';
    }

    return result;
  }

  function getInteractiveElements(doc) {
    const counter = { value: 1 };
    const selectors = [
      'textarea[name="q"]',
      'input[name="q"]',
      '.g a[href]',
      '[data-hveid] a[href]',
      '#pnnext',
      '#pnprev',
      'a[aria-label*="Page"]',
      'a[aria-label*="page"]',
      '.s75CFd a',
      '.brs_col a',
      '[role="listitem"] a',
      'a.fl',
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

      if (target === 'next' || target.toLowerCase() === 'next page') {
        el = doc.querySelector('#pnnext, a[aria-label="Next"]');
        if (el) return el;
      }
      if (target === 'prev' || target.toLowerCase() === 'previous page') {
        el = doc.querySelector('#pnprev, a[aria-label="Previous"]');
        if (el) return el;
      }

      const resultLinks = doc.querySelectorAll('.g a[href], [data-hveid] a[href]');
      for (const link of resultLinks) {
        if (link.textContent.trim().toLowerCase().includes(target.toLowerCase())) {
          return link;
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
      let el = doc.querySelector('textarea[name="q"], input[name="q"]');
      if (el) return el;

      el = doc.querySelector(target);
      if (el) return el;
    }
    return null;
  }

  return {
    name: 'google',
    hostPatterns: ['google.com', 'google.co.uk', 'google.ca', 'google.com.au', 'google.de', 'google.fr', 'google.co.jp', 'google.co.in'],
    readPage,
    getInteractiveElements,
    clickSelector,
    typeSelector,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = GoogleAdapter;
}

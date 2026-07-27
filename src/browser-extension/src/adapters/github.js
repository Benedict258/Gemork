const GitHubAdapter = (() => {
  function isRepoPage(doc) {
    return doc.querySelector('[data-testid="repository-container"]') ||
           doc.querySelector('.repository-content') ||
           doc.querySelector('#repo-content-turbo-frame') ||
           doc.querySelector('.js-repo-nav') ||
           doc.querySelector('[aria-label="Repository"]');
  }

  function isIssuePage(doc) {
    return doc.querySelector('.js-issue-row') ||
           doc.querySelector('[data-testid="issue-body"]') ||
           doc.querySelector('.gh-header-actions') ||
           doc.querySelector('[aria-label="Issues"]');
  }

  function isPRPage(doc) {
    return doc.querySelector('.pull-request-tab-content') ||
           doc.querySelector('[data-testid="pr-body"]') ||
           doc.querySelector('.gh-header-actions .btn-primary') ||
           doc.querySelector('[aria-label="Pull requests"]');
  }

  function readPage(doc) {
    const result = { type: 'unknown', content: {} };

    const readme = doc.querySelector('#readme article, .markdown-body, [data-testid="readme"]');
    if (readme) {
      result.content.readme = readme.innerText.slice(0, 10000);
    }

    const fileTree = doc.querySelector('.js-details-container .js-navigation-item, [data-testid="file-tree"] .react-directory-row, .Box .Box-row, .js-repo-nav');
    if (fileTree) {
      const fileLinks = doc.querySelectorAll('.js-navigation-item a, [data-testid="file-tree"] a, .Box .Box-row a, .js-repo-nav a');
      const files = Array.from(fileLinks).map(a => ({
        name: a.textContent.trim().slice(0, 200),
        href: a.href,
        type: 'file',
      }));
      result.content.files = files.slice(0, 100);
      result.type = 'repo';
    }

    const issueRows = doc.querySelectorAll('.js-issue-row, [data-testid="issue-row"]');
    if (issueRows.length > 0) {
      const issues = Array.from(issueRows).map(row => {
        const linkEl = row.querySelector('a[data-hovercard-type], .js-navigation-open');
        const labels = Array.from(row.querySelectorAll('.IssueLabel, [data-testid="label"]')).map(l => l.textContent.trim());
        const stateEl = row.querySelector('.octicon-issue-opened, .octicon-issue-closed, .octicon-git-pull-request, [data-testid="state-icon"]');
        return {
          title: linkEl?.textContent?.trim()?.slice(0, 200) || '',
          href: linkEl?.href || '',
          labels,
          state: stateEl?.getAttribute('aria-label') || '',
        };
      });
      result.content.issues = issues.slice(0, 50);
      result.type = 'issues';
    }

    const breadcrumbs = doc.querySelectorAll('.js-repo-nav a, [data-testid="repository-navigation"] a, nav[aria-label="Repository"] a');
    if (breadcrumbs.length > 0) {
      result.content.navigation = Array.from(breadcrumbs).map(a => ({
        text: a.textContent.trim(),
        href: a.href,
        active: a.getAttribute('aria-current') === 'page',
      }));
    }

    const tabs = doc.querySelectorAll('.UnderlineNav-item, [data-testid="issues-tab"], [data-testid="pull-requests-tab"]');
    if (tabs.length > 0) {
      result.content.tabs = Array.from(tabs).map(t => ({
        text: t.textContent.trim().slice(0, 50),
        href: t.href || t.querySelector('a')?.href || '',
        active: t.getAttribute('aria-current') === 'page',
      }));
    }

    const prBody = doc.querySelector('[data-testid="pr-body"], .comment-body');
    if (prBody) {
      result.content.prDescription = prBody.innerText.slice(0, 5000);
      result.type = 'pr';
    }

    const issueBody = doc.querySelector('[data-testid="issue-body"], .comment-body');
    if (issueBody && result.type === 'unknown') {
      result.content.issueDescription = issueBody.innerText.slice(0, 5000);
      result.type = 'issue';
    }

    const commitList = doc.querySelectorAll('.commit-group .commit, [data-testid="commit-row"]');
    if (commitList.length > 0) {
      result.content.commits = Array.from(commitList).map(c => ({
        message: (c.querySelector('.commit-message, [data-testid="commit-message"]')?.textContent || '').trim().slice(0, 200),
        sha: (c.querySelector('a[href*="/commit/"]')?.textContent || '').trim(),
      })).slice(0, 20);
    }

    const text = doc.body ? doc.body.innerText.slice(0, 50000) : '';
    result.content.text = text;

    return result;
  }

  function getInteractiveElements(doc) {
    const counter = { value: 1 };
    const selectors = [
      'a[href]:not([hidden])',
      'button:not([hidden])',
      'input:not([hidden])',
      'textarea:not([hidden])',
      'select:not([hidden])',
      '[role="button"]:not([hidden])',
      '[role="tab"]:not([hidden])',
      '.js-navigation-item a',
      '.breadcrumb a',
      '[data-testid="repository-navigation"] a',
      '.UnderlineNav-item',
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

      el = doc.querySelector(`[data-testid="${target}"]`);
      if (el) return el;

      el = doc.querySelector(`a[aria-label="${target}"], button[aria-label="${target}"]`);
      if (el) return el;

      const navLinks = doc.querySelectorAll('.js-navigation-item a, .UnderlineNav-item, [data-testid="repository-navigation"] a');
      for (const link of navLinks) {
        if (link.textContent.trim().toLowerCase() === target.toLowerCase()) {
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
      let el = doc.querySelector(target);
      if (el) return el;

      el = doc.querySelector('input[name="query"], input[name="q"], .header-search-input, [data-testid="search-input"]');
      if (el) return el;

      el = doc.querySelector(`input[placeholder="${target}"], textarea[placeholder="${target}"]`);
      if (el) return el;

      el = doc.querySelector('.comment-form-textarea, textarea[name="issue[body]"], textarea[name="pull_request[body]"]');
      if (el) return el;
    }
    return null;
  }

  return {
    name: 'github',
    hostPatterns: ['github.com'],
    readPage,
    getInteractiveElements,
    clickSelector,
    typeSelector,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = GitHubAdapter;
}

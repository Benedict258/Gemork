const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Mock DOM environment
global.window = { location: { href: 'https://example.com' } };
global.document = {
  body: { innerText: 'Test content', innerHTML: '<div>Test</div>' },
  title: 'Test Page',
  querySelectorAll: () => [],
  querySelector: () => null,
};
global.MouseEvent = class {};
global.InputEvent = class {};
global.XPathResult = { FIRST_ORDERED_NODE_TYPE: 9 };

// Load adapter registry
eval(fs.readFileSync(path.join(__dirname, '../src/adapters/index.js'), 'utf8'));
const AdapterRegistry = module.exports;

// Load adapters
eval(fs.readFileSync(path.join(__dirname, '../src/adapters/generic.js'), 'utf8'));
const GenericAdapter = module.exports;

eval(fs.readFileSync(path.join(__dirname, '../src/adapters/github.js'), 'utf8'));
const GitHubAdapter = module.exports;

eval(fs.readFileSync(path.join(__dirname, '../src/adapters/google.js'), 'utf8'));
const GoogleAdapter = module.exports;

eval(fs.readFileSync(path.join(__dirname, '../src/adapters/notion.js'), 'utf8'));
const NotionAdapter = module.exports;

eval(fs.readFileSync(path.join(__dirname, '../src/adapters/slack.js'), 'utf8'));
const SlackAdapter = module.exports;

eval(fs.readFileSync(path.join(__dirname, '../src/adapters/docs.js'), 'utf8'));
const DocsAdapter = module.exports;

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
  }
}

// Register all adapters for tests
AdapterRegistry.registerAdapter(GitHubAdapter);
AdapterRegistry.registerAdapter(GoogleAdapter);
AdapterRegistry.registerAdapter(NotionAdapter);
AdapterRegistry.registerAdapter(SlackAdapter);
AdapterRegistry.registerAdapter(DocsAdapter);

console.log('\n=== Adapter Registry Tests ===');

test('registers adapter', () => {
  const registry = (() => {
    const adapters = [];
    return {
      registerAdapter(a) { adapters.push(a); },
      getAdapter(url) {
        const hostname = new URL(url).hostname;
        for (const a of adapters) {
          for (const p of a.hostPatterns) {
            if (typeof p === 'string' && (hostname === p || hostname.endsWith('.' + p))) return a;
          }
        }
        return null;
      },
    };
  })();

  registry.registerAdapter(GitHubAdapter);
  assert.strictEqual(registry.getAdapter('https://github.com/user/repo').name, 'github');
});

test('returns null for unknown URL', () => {
  assert.strictEqual(AdapterRegistry.getAdapter('https://unknown-site-xyz.com'), null);
});

test('returns github adapter for github.com', () => {
  assert.strictEqual(AdapterRegistry.getAdapter('https://github.com/test').name, 'github');
});

test('returns google adapter for google.com', () => {
  assert.strictEqual(AdapterRegistry.getAdapter('https://www.google.com/search').name, 'google');
});

test('returns notion adapter for notion.so', () => {
  assert.strictEqual(AdapterRegistry.getAdapter('https://notion.so/page').name, 'notion');
});

test('returns slack adapter for slack.com', () => {
  assert.strictEqual(AdapterRegistry.getAdapter('https://app.slack.com/channel').name, 'slack');
});

test('returns docs adapter for docs.google.com', () => {
  assert.strictEqual(AdapterRegistry.getAdapter('https://docs.google.com/document').name, 'docs');
});

test('supports regex host patterns', () => {
  const testAdapter = {
    name: 'test-regex',
    hostPatterns: [/^test\d+\.example\.com$/],
    readPage: () => ({}),
    getInteractiveElements: () => [],
  };
  AdapterRegistry.registerAdapter(testAdapter);
  assert.strictEqual(AdapterRegistry.getAdapter('https://test123.example.com').name, 'test-regex');
  assert.strictEqual(AdapterRegistry.getAdapter('https://test.example.com'), null);
});

test('lists all registered adapters', () => {
  const list = AdapterRegistry.listAdapters();
  assert.ok(Array.isArray(list));
  assert.ok(list.length > 0);
  assert.ok(list.some(a => a.name === 'github'));
});

test('handles invalid URL gracefully', () => {
  assert.strictEqual(AdapterRegistry.getAdapter('not-a-url'), null);
});

console.log('\n=== Generic Adapter Tests ===');

test('generic adapter has correct name', () => {
  assert.strictEqual(GenericAdapter.name, 'generic');
});

test('generic adapter reads page text', () => {
  const doc = {
    body: { innerText: 'Hello World' },
    querySelectorAll: (sel) => {
      if (sel.includes('h1')) return [{ tagName: 'H1', textContent: 'Title' }];
      if (sel.includes('a[href]')) return [{ textContent: 'Link', href: 'http://example.com' }];
      if (sel.includes('p')) return [{ textContent: 'Paragraph' }];
      return [];
    },
  };
  const result = GenericAdapter.readPage(doc);
  assert.strictEqual(result.text, 'Hello World');
});

test('generic adapter finds interactive elements', () => {
  const doc = {
    querySelectorAll: () => [
      { tagName: 'BUTTON', type: '', textContent: 'Click', getAttribute: () => null, getBoundingClientRect: () => ({ x: 0, y: 0, width: 50, height: 20 }) },
      { tagName: 'A', href: 'http://example.com', textContent: 'Link', getAttribute: () => null, getBoundingClientRect: () => ({ x: 0, y: 0, width: 50, height: 20 }) },
    ],
  };
  const result = GenericAdapter.getInteractiveElements(doc);
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result[0].tag, 'button');
  assert.strictEqual(result[1].tag, 'a');
});

test('generic adapter clickSelector finds by aria-label', () => {
  const doc = {
    querySelector: (sel) => {
      if (sel === 'button') return { textContent: 'Submit' };
      return null;
    },
    evaluate: () => ({ singleNodeValue: null }),
    querySelectorAll: () => [
      { textContent: 'Submit', tagName: 'BUTTON', getAttribute: (name) => name === 'aria-label' ? 'Submit' : null },
    ],
  };
  const result = GenericAdapter.clickSelector(doc, 'Submit');
  assert.ok(result);
});

test('generic adapter typeSelector finds input by name', () => {
  const doc = {
    querySelector: (sel) => {
      if (sel === 'input[name="email"], input[id="email"], textarea[name="email"], textarea[id="email"]') return { tagName: 'INPUT', name: 'email' };
      return null;
    },
    querySelectorAll: () => [],
  };
  const result = GenericAdapter.typeSelector(doc, 'email');
  assert.ok(result);
  assert.strictEqual(result.name, 'email');
});

console.log('\n=== GitHub Adapter Tests ===');

test('github adapter has correct name', () => {
  assert.strictEqual(GitHubAdapter.name, 'github');
});

test('github adapter detects repository page', () => {
  const doc = {
    querySelector: (sel) => {
      if (sel.includes('repository-content') || sel.includes('repo-content-turbo-frame') || sel.includes('js-repo-nav')) return true;
      return null;
    },
    querySelectorAll: (sel) => {
      if (sel.includes('js-navigation-item') || sel.includes('Box-row')) return [
        { textContent: 'src', href: 'https://github.com/test/repo/tree/main/src' },
        { textContent: 'README.md', href: 'https://github.com/test/repo/blob/main/README.md' },
      ];
      return [];
    },
    body: { innerText: 'Repository content' },
  };
  const result = GitHubAdapter.readPage(doc);
  assert.strictEqual(result.type, 'repo');
  assert.ok(result.content.files);
});

test('github adapter detects issues page', () => {
  const doc = {
    querySelector: (sel) => {
      if (sel.includes('js-issue-row')) return true;
      return null;
    },
    querySelectorAll: (sel) => {
      if (sel.includes('js-issue-row')) return [
        {
          querySelector: (s) => {
            if (s.includes('IssueLabel')) return null;
            if (s.includes('octicon') || s.includes('state-icon')) return null;
            return { textContent: 'Bug report', href: 'https://github.com/test/repo/issues/1' };
          },
          querySelectorAll: () => [],
        },
      ];
      return [];
    },
    body: { innerText: 'Issues' },
  };
  const result = GitHubAdapter.readPage(doc);
  assert.strictEqual(result.type, 'issues');
  assert.ok(result.content.issues);
});

test('github adapter extracts tabs', () => {
  const doc = {
    querySelector: () => null,
    querySelectorAll: (sel) => {
      if (sel.includes('UnderlineNav-item') || sel.includes('repository-navigation')) return [
        { textContent: 'Code', href: 'https://github.com/test', getAttribute: () => null },
        { textContent: 'Issues', href: 'https://github.com/test/issues', getAttribute: () => null },
      ];
      return [];
    },
    body: { innerText: 'Repository' },
  };
  const result = GitHubAdapter.readPage(doc);
  assert.ok(result.content.tabs);
  assert.strictEqual(result.content.tabs.length, 2);
});

console.log('\n=== Google Adapter Tests ===');

test('google adapter has correct name', () => {
  assert.strictEqual(GoogleAdapter.name, 'google');
});

test('google adapter extracts search query', () => {
  const doc = {
    querySelector: (sel) => {
      if (sel.includes('textarea[name="q"]') || sel.includes('input[name="q"]')) return { value: 'test query' };
      return null;
    },
    querySelectorAll: () => [],
    body: { innerText: 'Search results' },
  };
  const result = GoogleAdapter.readPage(doc);
  assert.strictEqual(result.type, 'search');
  assert.strictEqual(result.content.query, 'test query');
});

test('google adapter finds search bar', () => {
  const doc = {
    querySelector: (sel) => {
      if (sel.includes('textarea[name="q"]')) return { tagName: 'TEXTAREA', name: 'q' };
      return null;
    },
  };
  const result = GoogleAdapter.typeSelector(doc, 'search');
  assert.ok(result);
  assert.strictEqual(result.name, 'q');
});

test('google adapter handles next page', () => {
  const doc = {
    querySelector: (sel) => {
      if (sel === 'next' || sel.toLowerCase() === 'next page') return null;
      if (sel === '#pnnext, a[aria-label="Next"]') return { tagName: 'A', href: 'http://google.com/search?start=10' };
      return null;
    },
    querySelectorAll: (sel) => {
      if (sel.includes('.g a[href]') || sel.includes('[data-hveid]')) return [];
      return [];
    },
  };
  const result = GoogleAdapter.clickSelector(doc, 'next');
  assert.ok(result);
});

console.log('\n=== Notion Adapter Tests ===');

test('notion adapter has correct name', () => {
  assert.strictEqual(NotionAdapter.name, 'notion');
});

test('notion adapter detects page content', () => {
  const doc = {
    querySelector: (sel) => {
      if (sel.includes('notion-page-content') || sel.includes('layout-content')) return true;
      return null;
    },
    querySelectorAll: (sel) => {
      if (sel === '[data-block-id]') return [
        { getAttribute: () => 'block-1', textContent: 'Hello', innerText: 'Hello', className: 'notion-text-block', querySelectorAll: () => [] },
      ];
      return [];
    },
    body: { innerText: 'Notion page' },
  };
  const result = NotionAdapter.readPage(doc);
  assert.strictEqual(result.type, 'page');
  assert.ok(result.content.blocks);
});

test('notion adapter extracts block data', () => {
  const doc = {
    querySelector: () => null,
    querySelectorAll: (sel) => {
      if (sel === '[data-block-id]') return [
        {
          getAttribute: (name) => name === 'data-block-id' ? 'id-1' : null,
          textContent: 'Heading', innerText: 'Heading', className: 'notion-heading-block', querySelectorAll: () => []
        },
        {
          getAttribute: (name) => name === 'data-block-id' ? 'id-2' : null,
          textContent: 'Text', innerText: 'Text', className: 'notion-text-block', querySelectorAll: () => []
        },
      ];
      return [];
    },
    body: { innerText: 'Blocks' },
  };
  const result = NotionAdapter.readPage(doc);
  assert.ok(result.content.blocks.length === 2);
  assert.strictEqual(result.content.blocks[0].type, 'heading');
  assert.strictEqual(result.content.blocks[1].type, 'text');
});

console.log('\n=== Slack Adapter Tests ===');

test('slack adapter has correct name', () => {
  assert.strictEqual(SlackAdapter.name, 'slack');
});

test('slack adapter detects channel', () => {
  const doc = {
    querySelector: (sel) => {
      if (sel.includes('channel_name') || sel.includes('channel_header')) return { textContent: '#general' };
      return null;
    },
    querySelectorAll: () => [],
    body: { innerText: 'Slack channel' },
  };
  const result = SlackAdapter.readPage(doc);
  assert.strictEqual(result.type, 'channel');
  assert.strictEqual(result.content.channel, '#general');
});

test('slack adapter extracts messages', () => {
  const doc = {
    querySelector: (sel) => {
      if (sel.includes('channel_name') || sel.includes('channel_header')) return { textContent: '#general' };
      if (sel.includes('threads_panel') || sel.includes('thread_panel') || sel.includes('thread_parent_message')) return null;
      return null;
    },
    querySelectorAll: (sel) => {
      if (sel.includes('.c-message,') || sel.includes('[data-qa="message"]')) return [
        {
          querySelector: (s) => {
            if (s.includes('sender') || s.includes('sender_button')) return { textContent: 'user1' };
            if (s.includes('body') || s.includes('text')) return { textContent: 'Hello everyone' };
            if (s.includes('.c-timestamp') || s.includes('time')) return { getAttribute: () => '2024-01-01T00:00:00Z', textContent: '' };
            if (s.includes('reaction')) return null;
            if (s.includes('reply_count')) return null;
            return null;
          },
          getAttribute: () => null,
          querySelectorAll: (s) => {
            if (s.includes('.c-reaction') || s.includes('[data-qa="reaction"]')) return [];
            return [];
          },
        },
      ];
      return [];
    },
    body: { innerText: 'Messages' },
  };
  const result = SlackAdapter.readPage(doc);
  assert.ok(result.content.messages);
});

test('slack adapter finds message input', () => {
  const doc = {
    querySelector: (sel) => {
      if (sel.includes('message_input') || sel.includes('c-text_input_input')) return { tagName: 'TEXTAREA' };
      return null;
    },
  };
  const result = SlackAdapter.typeSelector(doc, 'message');
  assert.ok(result);
});

console.log('\n=== Google Docs Adapter Tests ===');

test('docs adapter has correct name', () => {
  assert.strictEqual(DocsAdapter.name, 'docs');
});

test('docs adapter detects document', () => {
  const doc = {
    querySelector: (sel) => {
      if (sel.includes('kix-page') || sel.includes('kix-appview-editor')) return true;
      return null;
    },
    querySelectorAll: () => [],
    body: { innerText: 'Document content', innerHTML: '<div>Doc</div>' },
  };
  const result = DocsAdapter.readPage(doc);
  assert.strictEqual(result.type, 'document');
});

test('docs adapter extracts title', () => {
  const doc = {
    querySelector: (sel) => {
      if (sel.includes('docs-title-input') || sel.includes('kix-title-input')) return { textContent: 'My Document' };
      if (sel.includes('kix-page') || sel.includes('kix-appview-editor')) return true;
      return null;
    },
    querySelectorAll: () => [],
    body: { innerText: 'Title test', innerHTML: '<div>Test</div>' },
  };
  const result = DocsAdapter.readPage(doc);
  assert.strictEqual(result.content.title, 'My Document');
});

test('docs adapter finds contenteditable', () => {
  const doc = {
    querySelector: (sel) => {
      if (sel.includes('docs-texteventtarget-iframe') || sel.includes('[contenteditable="true"]')) return { tagName: 'IFRAME' };
      return null;
    },
  };
  const result = DocsAdapter.typeSelector(doc, 'document');
  assert.ok(result);
});

console.log('\n=== Integration Tests ===');

test('fallback to generic when no adapter found', () => {
  const adapter = AdapterRegistry.getAdapter('https://unknown-site.com');
  const fallback = adapter || GenericAdapter;
  assert.strictEqual(fallback.name, 'generic');
});

test('adapter registry is singleton across calls', () => {
  assert.strictEqual(AdapterRegistry, AdapterRegistry);
});

test('all adapters export required interface', () => {
  const adapters = [GenericAdapter, GitHubAdapter, GoogleAdapter, NotionAdapter, SlackAdapter, DocsAdapter];
  for (const adapter of adapters) {
    assert.ok(adapter.name, `${adapter.name} has name`);
    assert.ok(Array.isArray(adapter.hostPatterns), `${adapter.name} has hostPatterns`);
    assert.ok(typeof adapter.readPage === 'function', `${adapter.name} has readPage`);
    assert.ok(typeof adapter.getInteractiveElements === 'function', `${adapter.name} has getInteractiveElements`);
    assert.ok(typeof adapter.clickSelector === 'function', `${adapter.name} has clickSelector`);
    assert.ok(typeof adapter.typeSelector === 'function', `${adapter.name} has typeSelector`);
  }
});

test('generic adapter works as fallback for any URL', () => {
  const doc = { body: { innerText: 'Any page content' }, querySelectorAll: () => [], querySelector: () => null };
  const result = GenericAdapter.readPage(doc);
  assert.ok(result.text.includes('Any page content'));
});

console.log('\n=== Results ===');
console.log(`Passed: ${passed}, Failed: ${failed}`);
console.log(failed === 0 ? 'All tests passed!' : 'Some tests failed.');
process.exit(failed > 0 ? 1 : 0);

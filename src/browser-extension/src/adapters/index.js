const AdapterRegistry = (() => {
  const adapters = [];

  function registerAdapter(adapter) {
    if (!adapter || !adapter.name || !adapter.hostPatterns) {
      console.warn('[Gemork] Invalid adapter:', adapter);
      return;
    }
    adapters.push(adapter);
  }

  function getAdapter(url) {
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname;
      let bestMatch = null;
      let bestScore = -1;

      for (const adapter of adapters) {
        for (const pattern of adapter.hostPatterns) {
          let score = 0;
          let matched = false;

          if (typeof pattern === 'string') {
            if (hostname === pattern) {
              score = 100;
              matched = true;
            } else if (hostname.endsWith('.' + pattern)) {
              score = pattern.split('.').length;
              matched = true;
            }
          } else if (pattern instanceof RegExp) {
            if (pattern.test(hostname) || pattern.test(url)) {
              score = 50;
              matched = true;
            }
          }

          if (matched && score > bestScore) {
            bestScore = score;
            bestMatch = adapter;
          }
        }
      }
      return bestMatch;
    } catch (e) {
      console.warn('[Gemork] Invalid URL for adapter lookup:', url);
      return null;
    }
  }

  function listAdapters() {
    return adapters.map(a => ({ name: a.name, hostPatterns: a.hostPatterns }));
  }

  return { registerAdapter, getAdapter, listAdapters };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AdapterRegistry;
}

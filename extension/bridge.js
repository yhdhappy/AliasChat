(() => {
  const { mask, unmask, deepMap, configure, hasPlaceholder } = globalThis.pii;
  const { maskFile, maskFileName } = globalThis.mask2aiFiles;
  // Inlined from extension/rewrite.js: rewrite.js is also loaded in the MAIN
  // world, and Chrome does not reliably provide its global in the isolated
  // world when the same file appears in both. Inlining removes the dependency.
  const TEXT_KEYS = new Set(['prompt', 'parts', 'extracted_content', 'text', 'content', 'message_content', 'file_name']);
  const walk = (v, key, maskFn, found, attachment = false) => typeof v === 'string' ? (key === 'file_name' ? maskFileName(v, maskFn, found) : TEXT_KEYS.has(key) ? maskFn(v, found) : v)
    : Array.isArray(v) ? v.map(x => walk(x, key, maskFn, found, key === 'attachments'))
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, attachment && k === 'name' ? 'file_name' : k, maskFn, found)]))
    : v;
  const rewriteJson = (text, maskFn, found) => JSON.stringify(walk(JSON.parse(text), '', maskFn, found));
  const rewriteForm = (text, maskFn, found) => {
    const params = new URLSearchParams(text);
    for (const [k, v] of [...params.entries()]) {
      if (TEXT_KEYS.has(k)) params.set(k, k === 'file_name' ? maskFileName(v, maskFn, found) : maskFn(v, found));
      else if (/^[[{]/.test(v)) {
        let parsed;
        try { parsed = JSON.parse(v); } catch { continue; }
        params.set(k, JSON.stringify(walk(parsed, '', maskFn, found)));
      }
    }
    return params.toString();
  };
  const rewrite = (bodyText, maskFn, found) => /^\s*[[{]/.test(bodyText) ? rewriteJson(bodyText, maskFn, found) : rewriteForm(bodyText, maskFn, found);
  const token = [...crypto.getRandomValues(new Uint8Array(32))].map(n => n.toString(16).padStart(2, '0')).join('');
  const getMap = async () => (await chrome.runtime.sendMessage({ type: 'privy-map-get' })).privyMap || {};
  const setMap = async map => {
    const response = await chrome.runtime.sendMessage({ type: 'privy-map-set', privyMap: map });
    if (response?.error) throw Object.assign(new Error(response.error), { code: 'map-storage-error' });
  };
  let queue = Promise.resolve();
  const MASK_CAPACITY = 10;
  const MASK_REFILL_MS = 10000;
  let maskTokens = MASK_CAPACITY;
  let maskRefilledAt = performance.now();
  let userConfig = {};
  const ready = new Promise((resolve, reject) => chrome.storage.sync.get('config', ({ config }) => {
    try {
      if (chrome.runtime.lastError) throw new Error(chrome.runtime.lastError.message);
      userConfig = config || {};
      configure(userConfig);
      resolve();
    } catch (error) { reject(error); }
  }));
  ready.catch(() => {});
  const sendConfig = () => window.postMessage({ type: 'mask2ai-config', token }, location.origin);
  const unpackFile = file => new File([file.bytes], file.name, { type: file.type, lastModified: file.lastModified });
  const packFile = async file => ({ bytes: await file.arrayBuffer(), name: file.name, type: file.type, lastModified: file.lastModified });
  const run = async data => {
    await ready;
    let found = Object.create(null);
    const candidates = new Map();
    let tokenize = value => {
      if (!candidates.has(value)) candidates.set(value, [...crypto.getRandomValues(new Uint8Array(6))].map(n => n.toString(16).padStart(2, '0')).join(''));
      return candidates.get(value);
    };
    const maskText = (text, values) => mask(text, values, tokenize);
    const warnings = [];
    const file = async value => {
      return packFile(await maskFile(unpackFile(value), maskText, found, warning => warnings.push(warning), userConfig));
    };
    const processBody = async () => {
      let body;
      if (data.format === 'chat') body = rewrite(data.body, maskText, found);
      else if (data.format === 'file') body = await file(data.body);
      else if (data.format === 'form') {
        body = [];
        for (const entry of data.body) {
          let value = entry.file ? await file(entry.value) : entry.value;
          if (!entry.file && data.chat) value = new URLSearchParams(rewrite(new URLSearchParams([[entry.key, value]]).toString(), maskText, found)).get(entry.key);
          body.push({ key: entry.key, file: entry.file, value });
        }
      } else throw new Error('Unsupported masking format');
      return body;
    };
    let body = await processBody();
    const values = [...candidates.keys()];
    if (values.length) {
      const response = await chrome.runtime.sendMessage({ type: 'privy-digests', values });
      if (response?.error || !Array.isArray(response?.digests) || response.digests.length !== values.length || !response.digests.every(value => /^[0-9a-f]{12}$/.test(value))) throw new Error('Invalid private placeholders');
      const digests = new Map(values.map((value, i) => [value, response.digests[i]]));
      tokenize = value => {
        if (!digests.has(value)) throw new Error('Unprepared masking value');
        return digests.get(value);
      };
      found = Object.create(null);
      warnings.length = 0;
      body = await processBody();
    }
    const map = await getMap();
    for (const [placeholder, value] of Object.entries(found)) map[placeholder] = value;
    await setMap(map);
    return { body, count: Object.keys(found).length, warnings };
  };
  window.addEventListener('message', e => {
    const data = e.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'mask2ai-ready') return sendConfig();
    if (data.token !== token || data.type !== 'mask-request' || typeof data.id !== 'string') return;
    const now = performance.now();
    maskTokens = Math.min(MASK_CAPACITY, maskTokens + (now - maskRefilledAt) * MASK_CAPACITY / MASK_REFILL_MS);
    maskRefilledAt = now;
    if (maskTokens < 1) {
      window.postMessage({ type: 'mask-result', token, id: data.id, error: 'AliasChat is handling too many masking requests; please wait a moment and resend.' }, location.origin);
      return;
    }
    maskTokens--;
    queue = queue.then(async () => {
      try { window.postMessage({ type: 'mask-result', token, id: data.id, result: await run(data) }, location.origin); }
      catch (error) { window.postMessage({ type: 'mask-result', token, id: data.id, error: error.code === 'map-storage-error' ? error.message : 'AliasChat could not process personal data safely', code: ['opaque-blocked', 'unknown-blocked', 'map-storage-error'].includes(error.code) ? error.code : undefined }, location.origin); }
    });
  });
  sendConfig();

  const eligible = node => node.nodeType === 3 && hasPlaceholder(node.data) && !node.parentElement?.closest('[contenteditable], textarea, [data-mask2ai]');
  const unknownPlaceholders = new Map();
  const pendingNodes = new Set();
  let unmaskTimer;
  const PLACEHOLDER_RE = /__PII_[A-Z_]+_(?:[0-9a-f]{12}|[0-9a-f]{6})__/g;
  let unmaskWindowStart = 0;
  let unmaskCount = 0;
  new MutationObserver(muts => {
    for (const m of muts) {
      if (m.type === 'characterData' && eligible(m.target)) pendingNodes.add(m.target);
      for (const n of m.addedNodes) {
        if (eligible(n)) pendingNodes.add(n);
        else if (n.nodeType === 1) {
          const walker = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
          let child;
          while ((child = walker.nextNode())) if (eligible(child)) pendingNodes.add(child);
        }
      }
    }
    return flushUnmask();
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  const flushUnmask = async () => {
    if (!pendingNodes.size) return;
    const now = Date.now();
    if (now - unmaskWindowStart >= 1000) {
      unmaskWindowStart = now;
      unmaskCount = 0;
    }
    if (unmaskCount >= 10) {
      if (!unmaskTimer) unmaskTimer = setTimeout(() => {
        unmaskTimer = undefined;
        void flushUnmask();
      }, Math.max(0, 1000 - (now - unmaskWindowStart)));
      return;
    }
    unmaskCount++;
    const nodes = [...pendingNodes];
    pendingNodes.clear();
    const targets = nodes.filter(node => {
      if (!eligible(node)) return false;
      const placeholders = node.data.match(PLACEHOLDER_RE) || [];
      return placeholders.some(p => !unknownPlaceholders.has(p) || now - unknownPlaceholders.get(p) >= 30000);
    });
    if (!targets.length) return;
    const values = await getMap();
    const original = targets.map(node => node.data);
    const body = original.map(text => unmask(text, values));
    for (let i = 0; i < targets.length; i++) {
      const placeholders = original[i].match(PLACEHOLDER_RE) || [];
      for (const p of placeholders) if (body[i].includes(p)) unknownPlaceholders.set(p, now);
    }
    const updates = targets.map((node, i) => ({ node, before: original[i], after: body[i] })).filter(({ node, before, after }) => after !== before && node.data === before && eligible(node));
    if (!updates.length) return;
    const applied = [];
    try {
      for (const update of updates) {
        applied.push(update);
        update.node.data = update.after;
      }
    } catch (error) {
      for (const { node, before } of applied) {
        try { node.data = before; } catch {}
      }
    }
  };
})();

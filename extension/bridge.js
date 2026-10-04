(() => {
  const { mask, unmask, deepMap, configure, hasPlaceholder } = globalThis.pii;
  const { maskFile, classify } = globalThis.mask2aiFiles;
  // Inlined from extension/rewrite.js: rewrite.js is also loaded in the MAIN
  // world, and Chrome does not reliably provide its global in the isolated
  // world when the same file appears in both. Inlining removes the dependency.
  const TEXT_KEYS = new Set(['prompt', 'parts', 'extracted_content', 'text', 'content']);
  const walk = (v, key, maskFn, found) => typeof v === 'string' ? (TEXT_KEYS.has(key) ? maskFn(v, found) : v)
    : Array.isArray(v) ? v.map(x => walk(x, key, maskFn, found))
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k, maskFn, found)]))
    : v;
  const rewriteJson = (text, maskFn, found) => JSON.stringify(walk(JSON.parse(text), '', maskFn, found));
  const rewriteForm = (text, maskFn, found) => {
    const params = new URLSearchParams(text);
    for (const [k, v] of [...params.entries()]) {
      if (TEXT_KEYS.has(k)) params.set(k, maskFn(v, found));
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
  const getMap = async () => (await chrome.storage.session.get('veilMap')).veilMap || {};
  const setMap = map => chrome.storage.session.set({ veilMap: map });
  let salt;
  let queue = Promise.resolve();
  const ready = new Promise((resolve, reject) => chrome.storage.sync.get('config', ({ config }) => {
    try {
      if (chrome.runtime.lastError) throw new Error(chrome.runtime.lastError.message);
      configure(config || {});
      resolve();
    } catch (error) { reject(error); }
  }));
  ready.catch(() => {});
  const sendConfig = () => window.postMessage({ type: 'mask2ai-config', token }, '*');
  const unpackFile = file => new File([file.bytes], file.name, { type: file.type, lastModified: file.lastModified });
  const packFile = async file => ({ bytes: await file.arrayBuffer(), name: file.name, type: file.type, lastModified: file.lastModified });
  const run = async data => {
    await ready;
    if (data.type === 'map-clear') {
      await chrome.storage.session.remove('veilMap');
      return {};
    }
    if (typeof data.salt !== 'string' || !/^[0-9a-f]{64}$/.test(data.salt)) throw new Error('Invalid masking session');
    salt ??= data.salt;
    const found = Object.create(null);
    const maskText = (text, values) => mask(text, values, salt);
    const warnings = [];
    const file = async value => {
      if (classify(value.name) === 'opaque') warnings.push(value.name);
      return packFile(await maskFile(unpackFile(value), maskText, found));
    };
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
    const map = await getMap();
    for (const [placeholder, value] of Object.entries(found)) map[placeholder] = value;
    await setMap(map);
    return { body, count: Object.keys(found).length, warnings };
  };
  window.addEventListener('message', e => {
    const data = e.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'mask2ai-ready') return sendConfig();
    if (data.token !== token || !['mask-request', 'map-clear'].includes(data.type) || typeof data.id !== 'string') return;
    queue = queue.then(async () => {
      try { window.postMessage({ type: data.type === 'map-clear' ? 'map-cleared' : data.type.replace('-request', '-result'), token, id: data.id, result: await run(data) }, '*'); }
      catch { window.postMessage({ type: data.type === 'map-clear' ? 'map-cleared' : data.type.replace('-request', '-result'), token, id: data.id, error: 'VeilAI could not process personal data safely' }, '*'); }
    });
  });
  sendConfig();

  const eligible = node => node.nodeType === 3 && hasPlaceholder(node.data) && !node.parentElement?.closest('[contenteditable], textarea, [data-mask2ai]');
  const unknownPlaceholders = new Set();
  const PLACEHOLDER_RE = /__PII_[A-Z_]+_(?:[0-9a-f]{12}|[0-9a-f]{6})__/g;
  let unmaskWindowStart = 0;
  let unmaskCount = 0;
  new MutationObserver(async muts => {
    const nodes = new Set();
    for (const m of muts) {
      if (m.type === 'characterData' && eligible(m.target)) nodes.add(m.target);
      for (const n of m.addedNodes) {
        if (eligible(n)) nodes.add(n);
        else if (n.nodeType === 1) {
          const walker = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
          let child;
          while ((child = walker.nextNode())) if (eligible(child)) nodes.add(child);
        }
      }
    }
    if (!nodes.size) return;
    const now = Date.now();
    if (now - unmaskWindowStart > 1000) {
      unmaskWindowStart = now;
      unmaskCount = 0;
    }
    if (unmaskCount >= 10) return;
    unmaskCount++;
    const targets = [...nodes].filter(node => {
      const placeholders = node.data.match(PLACEHOLDER_RE) || [];
      return placeholders.some(p => !unknownPlaceholders.has(p));
    });
    if (!targets.length) return;
    const values = await getMap();
    const original = targets.map(node => node.data);
    const body = original.map(text => unmask(text, values));
    for (let i = 0; i < targets.length; i++) {
      const placeholders = original[i].match(PLACEHOLDER_RE) || [];
      for (const p of placeholders) if (body[i].includes(p)) unknownPlaceholders.add(p);
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
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
})();
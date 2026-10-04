(() => {
  const { mask, unmask, deepMap, configure } = globalThis.pii;
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
  const map = new Map();
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
      map.clear();
      return {};
    }
    if (data.type === 'unmask-request') {
      const values = Object.fromEntries(map);
      return { body: deepMap(data.body, text => unmask(text, values)) };
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
    for (const [placeholder, value] of Object.entries(found)) map.set(placeholder, value);
    return { body, count: Object.keys(found).length, warnings };
  };
  window.addEventListener('message', e => {
    const data = e.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'mask2ai-ready') return sendConfig();
    if (data.token !== token || !['mask-request', 'unmask-request', 'map-clear'].includes(data.type) || typeof data.id !== 'string') return;
    queue = queue.then(async () => {
      try { window.postMessage({ type: data.type === 'map-clear' ? 'map-cleared' : data.type.replace('-request', '-result'), token, id: data.id, result: await run(data) }, '*'); }
      catch { window.postMessage({ type: data.type === 'map-clear' ? 'map-cleared' : data.type.replace('-request', '-result'), token, id: data.id, error: 'VeilAI could not process personal data safely' }, '*'); }
    });
  });
  sendConfig();
})();
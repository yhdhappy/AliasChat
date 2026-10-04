(() => {
  const { mask, unmask, deepMap, configure } = globalThis.pii;
  const { rewrite } = globalThis.piiRewrite;
  const { maskFile, classify } = globalThis.mask2aiFiles;
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
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
  const pageBucket = { capacity: 10, refillPerMs: 1 / 1000, tokens: 10, refilledAt: performance.now() };
  const contentBucket = { capacity: 50, refillPerMs: 10 / 1000, tokens: 50, refilledAt: performance.now() };
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
  const BLOCK_CODES = ['opaque-blocked', 'unknown-blocked', 'encoding-blocked'];
  const BLOCK_TEXT = {
    'opaque-blocked': 'The browser cannot inspect images or PDFs, which may contain personal data.',
    'unknown-blocked': 'This file type cannot be inspected in the browser and may contain personal data.',
    'encoding-blocked': 'This text file\u2019s encoding cannot be decoded safely, so its contents cannot be inspected.'
  };
  const confirmUpload = (fileName, code) => new Promise(resolve => {
    let settled = false;
    let overlay;
    let timer;
    const finish = ok => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { document.removeEventListener('keydown', onKey); } catch {}
      try { overlay.remove(); } catch {}
      resolve(ok);
    };
    const onKey = e => { if (e.key === 'Escape') finish(false); };
    try {
      if (typeof document.createElement !== 'function' || !document.body || typeof document.body.appendChild !== 'function') return finish(false);
      const text = BLOCK_TEXT[code] || BLOCK_TEXT['opaque-blocked'];
      overlay = document.createElement('div');
      overlay.setAttribute('data-mask2ai', '');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5);font:14px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;';
      const box = document.createElement('div');
      box.style.cssText = 'background:#fff;color:#1c1b18;border-radius:12px;padding:22px 24px;max-width:27rem;margin:16px;box-shadow:0 12px 40px rgba(0,0,0,.4);';
      const title = document.createElement('div');
      title.style.cssText = 'font-size:16px;font-weight:700;margin-bottom:8px;';
      title.textContent = '🛡 Upload blocked by AliasChat';
      const body = document.createElement('div');
      body.style.cssText = 'color:#444;margin-bottom:4px;';
      body.textContent = text + ' This upload was blocked to protect you; it is not a network problem.';
      const name = document.createElement('div');
      name.style.cssText = 'font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#777;margin:8px 0 16px;word-break:break-all;';
      name.textContent = fileName;
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;';
      const mkButton = (label, primary, action) => {
        const button = document.createElement('button');
        button.textContent = label;
        button.dataset.action = action;
        button.style.cssText = primary
          ? 'border:none;border-radius:8px;background:#6b21a8;color:#fff;padding:9px 18px;font:inherit;cursor:pointer;'
          : 'border:1px solid #ccc;border-radius:8px;background:#fff;color:#333;padding:9px 18px;font:inherit;cursor:pointer;';
        button.addEventListener('click', () => finish(action === 'allow'));
        return button;
      };
      row.appendChild(mkButton('Cancel', false, 'cancel'));
      row.appendChild(mkButton('Upload once', true, 'allow'));
      const link = document.createElement('button');
      link.textContent = 'Allow all in options →';
      link.style.cssText = 'border:none;background:none;color:#6b21a8;padding:0;margin-top:14px;font:13px/1.5 system-ui,sans-serif;cursor:pointer;text-decoration:underline;';
      link.addEventListener('click', () => {
        try { chrome.runtime.openOptionsPage(); } catch {}
        finish(false);
      });
      box.appendChild(title);
      box.appendChild(body);
      box.appendChild(name);
      box.appendChild(row);
      box.appendChild(link);
      overlay.appendChild(box);
      overlay.addEventListener('click', e => { if (e.target === overlay) finish(false); });
      document.addEventListener('keydown', onKey);
      document.body.appendChild(overlay);
      timer = setTimeout(() => finish(false), 120000);
    } catch { finish(false); }
  });
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
    const allowedOnce = new Set();
    const file = async value => {
      try {
        return packFile(await maskFile(unpackFile(value), maskText, found, warning => warnings.push(warning), userConfig));
      } catch (error) {
        if (!BLOCK_CODES.includes(error.code)) throw error;
        if (!allowedOnce.has(value) && !(await confirmUpload(value.name, error.code))) throw error;
        allowedOnce.add(value);
        warnings.push(value.name + ' was uploaded without masking: the browser cannot inspect this file type');
        return value;
      }
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
  let contentPort;
  const handleMaskRequest = (data, bucket) => {
    if (!data || typeof data !== 'object') return;
    if (data.token !== token || data.type !== 'mask-request' || typeof data.id !== 'string') return;
    const now = performance.now();
    bucket.tokens = Math.min(bucket.capacity, bucket.tokens + (now - bucket.refilledAt) * bucket.refillPerMs);
    bucket.refilledAt = now;
    if (bucket.tokens < 1) {
      window.postMessage({ type: 'mask-result', token, id: data.id, error: 'AliasChat is handling too many masking requests; please wait a moment and resend.' }, location.origin);
      return;
    }
    bucket.tokens--;
    queue = queue.then(async () => {
      try { window.postMessage({ type: 'mask-result', token, id: data.id, result: await run(data) }, location.origin); }
      catch (error) { window.postMessage({ type: 'mask-result', token, id: data.id, error: error.code === 'map-storage-error' ? error.message : 'AliasChat could not process personal data safely', code: ['opaque-blocked', 'unknown-blocked', 'encoding-blocked', 'map-storage-error'].includes(error.code) ? error.code : undefined }, location.origin); }
    });
  };
  window.addEventListener('message', e => {
    const data = e.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'mask2ai-ready') {
      if (!contentPort && e.ports?.[0]) {
        contentPort = e.ports[0];
        contentPort.onmessage = event => handleMaskRequest(event.data, contentBucket);
      }
      if (contentPort) contentPort.postMessage({ type: 'mask2ai-port-ack', token });
      return sendConfig();
    }
    if (data.type === 'mask2ai-open-options' && data.token === token) {
      try { chrome.runtime.openOptionsPage(); } catch {}
      return;
    }
    handleMaskRequest(data, pageBucket);
  });
  sendConfig();
  const requestPort = attempt => {
    if (contentPort || attempt >= 5) return;
    window.postMessage({ type: 'mask2ai-port-request' }, location.origin);
    setTimeout(() => requestPort(attempt + 1), 500);
  };
  setTimeout(() => requestPort(0), 250);

  const eligible = node => node.nodeType === 3 && hasPlaceholder(node.data) && !node.parentElement?.closest('[contenteditable], textarea, [data-mask2ai]');
  const unknownPlaceholders = new Map();
  const pendingNodes = new Set();
  let unmaskTimer;
  let unknownTimer;
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
  const scheduleUnknown = () => {
    let expiresAt = Infinity;
    for (const record of unknownPlaceholders.values()) {
      if (record.attempts < 10 && record.nodes.size) expiresAt = Math.min(expiresAt, record.seenAt + 30000);
    }
    if (expiresAt === Infinity) {
      clearTimeout(unknownTimer);
      unknownTimer = undefined;
      return;
    }
    if (unknownTimer) return;
    unknownTimer = setTimeout(async () => {
      unknownTimer = undefined;
      const now = Date.now();
      for (const record of unknownPlaceholders.values()) {
        if (record.attempts >= 10 || now - record.seenAt < 30000) continue;
        for (const node of record.nodes) if (node.isConnected !== false && eligible(node)) pendingNodes.add(node);
        record.nodes.clear();
      }
      await flushUnmask();
      scheduleUnknown();
    }, Math.max(0, expiresAt - Date.now()));
  };
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
      for (const p of placeholders) {
        const record = unknownPlaceholders.get(p);
        if (record && record.attempts < 10) record.nodes.add(node);
      }
      return placeholders.some(p => {
        const record = unknownPlaceholders.get(p);
        return !record || (record.attempts < 10 && now - record.seenAt >= 30000);
      });
    });
    if (!targets.length) return;
    const values = await getMap();
    const original = targets.map(node => node.data);
    const body = original.map(text => unmask(text, values));
    const attempted = new Set();
    for (let i = 0; i < targets.length; i++) {
      const placeholders = original[i].match(PLACEHOLDER_RE) || [];
      for (const p of placeholders) {
        if (!body[i].includes(p)) {
          unknownPlaceholders.delete(p);
          continue;
        }
        let record = unknownPlaceholders.get(p);
        if (!record) {
          record = { seenAt: now, attempts: 0, nodes: new Set() };
          unknownPlaceholders.set(p, record);
        }
        if (record.attempts >= 10) continue;
        if (!attempted.has(p)) {
          record.attempts++;
          record.seenAt = now;
          attempted.add(p);
        }
        if (record.attempts >= 10) record.nodes.clear();
        else record.nodes.add(targets[i]);
      }
    }
    scheduleUnknown();
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

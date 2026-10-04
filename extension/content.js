(() => {
  const { isChatRequest } = window.piiRewrite;
  const salt = [...crypto.getRandomValues(new Uint8Array(32))].map(n => n.toString(16).padStart(2, '0')).join('');
  const pending = new Map();
  let token;
  let sequence = 0;
  let acceptConfig;
  const ready = new Promise(resolve => { acceptConfig = resolve; });
  const hasPlaceholder = text => /__PII_[A-Z_]+_(?:[0-9a-f]{12}|[0-9a-f]{6})__/.test(text);
  window.addEventListener('message', e => {
    const data = e.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'mask2ai-config') {
      if (token || typeof data.token !== 'string' || !/^[0-9a-f]{64}$/.test(data.token)) return;
      // First config wins. Page scripts can observe the token, preempt this handshake, or forge RPC traffic; postMessage cannot authenticate the isolated bridge.
      token = data.token;
      acceptConfig();
      return;
    }
    if (data.token !== token || !['mask-result', 'unmask-result', 'map-cleared'].includes(data.type)) return;
    const request = pending.get(data.id);
    if (!request || request.type !== data.type) return;
    pending.delete(data.id);
    clearTimeout(request.timer);
    data.error ? request.reject(new Error(data.error)) : request.resolve(data.result);
  });
  window.postMessage({ type: 'mask2ai-ready' }, '*');
  const rpc = (type, payload) => new Promise((resolve, reject) => {
    const id = salt + ':' + ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('VeilAI bridge did not respond'));
    }, 10000);
    pending.set(id, { resolve, reject, timer, type: type === 'map-clear' ? 'map-cleared' : type.replace('-request', '-result') });
    ready.then(() => {
      if (pending.has(id)) window.postMessage({ type, token, id, salt, ...payload }, '*');
    });
  });

  const style = 'position:fixed;z-index:2147483647;font:13px/1.4 system-ui,sans-serif;color:#fff;background:#6b21a8;border-radius:8px;padding:6px 10px;box-shadow:0 2px 8px rgba(0,0,0,.3);pointer-events:none;';
  const show = (text, ms) => {
    const el = document.createElement('div');
    el.setAttribute('data-mask2ai', '');
    el.style.cssText = style + 'right:16px;bottom:16px;';
    el.textContent = '🛡 VeilAI: ' + text;
    (document.body || document.documentElement).appendChild(el);
    if (ms) setTimeout(() => el.remove(), ms);
  };
  const failure = () => show('could not mask personal data; request blocked', 6000);
  document.addEventListener('DOMContentLoaded', () => show('on, personal data is masked before sending', 4000));

  const gunzip = bytes => new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  const gzip = async text => new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  const packFile = async file => ({ bytes: await file.arrayBuffer(), name: file.name, type: file.type, lastModified: file.lastModified });
  const unpackFile = file => new File([file.bytes], file.name, { type: file.type, lastModified: file.lastModified });
  const maskBody = async (url, body) => {
    let payload;
    let restore = value => value;
    if (body instanceof FormData) {
      const entries = [];
      for (const [key, value] of body) entries.push({ key, file: value instanceof File, value: value instanceof File ? await packFile(value) : value });
      payload = { format: 'form', body: entries, chat: isChatRequest(url) };
      restore = values => {
        const form = new FormData();
        for (const entry of values) entry.file ? form.append(entry.key, unpackFile(entry.value), entry.value.name) : form.append(entry.key, entry.value);
        return form;
      };
    } else if (body instanceof File) {
      payload = { format: 'file', body: await packFile(body) };
      restore = unpackFile;
    } else if (isChatRequest(url) && body != null) {
      if (typeof body === 'string') payload = { format: 'chat', body };
      else if (body instanceof URLSearchParams) {
        payload = { format: 'chat', body: body.toString() };
        restore = value => new URLSearchParams(value);
      } else if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
        const bytes = body instanceof ArrayBuffer ? new Uint8Array(body) : new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
        const gz = bytes[0] === 0x1f && bytes[1] === 0x8b;
        payload = { format: 'chat', body: gz ? await gunzip(bytes) : new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
        restore = value => gz ? gzip(value) : new TextEncoder().encode(value);
      } else if (body instanceof Blob) {
        payload = { format: 'chat', body: await body.text() };
        restore = value => new Blob([value], { type: body.type });
      } else throw new Error('Unsupported chat request body');
    }
    if (!payload) return body;
    const result = await rpc('mask-request', payload);
    for (const name of result.warnings) show(`${name} was uploaded uninspected, PDFs and images are not masked in the browser`, 6000);
    if (result.count) show(`masked ${result.count} value${result.count === 1 ? '' : 's'} before sending`, 4000);
    else show(`[diag] chat request intercepted, 0 values masked (${payload.format})`, 4000);
    return restore(result.body);
  };

  const origFetch = window.fetch;
  // [diag] Intercept WebSocket to see if retry uses it
  const OrigWebSocket = window.WebSocket;
  window.WebSocket = function (url, protocols) {
    try { show(`[diag] ws open ${String(url).slice(0, 80)}`, 4000); } catch {}
    const ws = new OrigWebSocket(url, protocols);
    const origSend = ws.send;
    ws.send = function (data) {
      try { show(`[diag] ws send ${String(data).slice(0, 80)}`, 4000); } catch {}
      return origSend.call(this, data);
    };
    return ws;
  };
  window.WebSocket.prototype = OrigWebSocket.prototype;
  window.fetch = async function (input, init) {
    try {
      const url = input instanceof Request ? input.url : String(input);
      try { const u = new URL(url, location.href); show(`[diag] fetch ${u.host}${u.pathname.slice(0, 60)}`, 4000); } catch {}
      if (init && init.body != null) init = { ...init, body: await maskBody(url, init.body) };
      else if (input instanceof Request && input.body && isChatRequest(url)) input = new Request(input, { body: await maskBody(url, await input.clone().arrayBuffer()) });
    } catch (error) {
      failure();
      throw error;
    }
    return origFetch.call(this, input, init);
  };

  const proto = window.XMLHttpRequest.prototype;
  const open = proto.open;
  const send = proto.send;
  const abort = proto.abort;
  const states = new WeakMap();
  const responseText = Object.getOwnPropertyDescriptor(proto, 'responseText').get;
  const response = Object.getOwnPropertyDescriptor(proto, 'response').get;
  proto.open = function (method, url, async = true, ...args) {
    const state = { url: String(url), async: async !== false, active: true, restored: false, replay: false, events: [], running: false };
    states.set(this, state);
    if (!Object.hasOwn(this, 'responseText')) {
      Object.defineProperties(this, {
        responseText: { configurable: true, get() { const s = states.get(this); return s?.restored && ['', 'text'].includes(this.responseType) ? s.text : responseText.call(this); } },
        response: { configurable: true, get() { const s = states.get(this); return s?.restored ? s.value : response.call(this); } }
      });
      for (const type of ['readystatechange', 'load', 'loadend']) this.addEventListener(type, event => {
        const s = states.get(this);
        if (!s?.active || s.replay || !isChatRequest(s.url) || this.readyState !== 4 || !['', 'text', 'json'].includes(this.responseType)) return;
        event.stopImmediatePropagation();
        s.events.push(typeof ProgressEvent !== 'undefined' && event instanceof ProgressEvent ? new ProgressEvent(type, { lengthComputable: event.lengthComputable, loaded: event.loaded, total: event.total }) : new Event(type));
        if (s.running) return;
        s.running = true;
        const raw = this.responseType === 'json' ? response.call(this) : responseText.call(this);
        rpc('unmask-request', { body: raw }).then(result => {
          if (states.get(this) !== s || !s.active) return;
          s.restored = true;
          s.value = result.body;
          s.text = this.responseType === 'json' ? undefined : result.body;
        }).catch(() => {}).finally(() => {
          if (states.get(this) !== s || !s.active) return;
          s.replay = true;
          for (const queued of s.events.splice(0)) this.dispatchEvent(queued);
          s.replay = false;
        });
      }, true);
    }
    return open.call(this, method, url, async, ...args);
  };
  proto.send = function (body) {
    const state = states.get(this);
    if (!state) return send.call(this, body);
    try { const u = new URL(state.url, location.href); show(`[diag] xhr ${u.host}${u.pathname.slice(0, 60)}`, 4000); } catch {}
    const chat = isChatRequest(state.url);
    if (!chat && !(body instanceof FormData) && !(body instanceof File)) return send.call(this, body);
    if (!state.async) {
      if (!chat) return send.call(this, body);
      failure();
      throw new Error('VeilAI requires asynchronous XMLHttpRequest for masking');
    }
    maskBody(state.url, body).then(masked => {
      if (state.active && states.get(this) === state) send.call(this, masked);
    }).catch(() => {
      if (!state.active || states.get(this) !== state) return;
      failure();
      state.active = false;
      abort.call(this);
      this.dispatchEvent(new Event('error'));
      this.dispatchEvent(new Event('loadend'));
    });
  };
  proto.abort = function () {
    const state = states.get(this);
    if (state) state.active = false;
    return abort.call(this);
  };

  const eligible = node => node.nodeType === 3 && hasPlaceholder(node.data) && !node.parentElement?.closest('[contenteditable], textarea, [data-mask2ai]');
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
    const targets = [...nodes];
    const original = targets.map(node => node.data);
    try {
      const { body } = await rpc('unmask-request', { body: original });
      if (!Array.isArray(body) || body.length !== targets.length || body.some(text => typeof text !== 'string')) throw new Error('Invalid restoration');
      const updates = targets.map((node, i) => ({ node, before: original[i], after: body[i] })).filter(({ node, before }) => node.data === before && eligible(node));
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
        throw error;
      }
    } catch {}
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
})();
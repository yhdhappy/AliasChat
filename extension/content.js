(() => {
  const { isChatRequest, isUploadMetadataRequest } = window.piiRewrite;
  const requestPrefix = [...crypto.getRandomValues(new Uint8Array(32))].map(n => n.toString(16).padStart(2, '0')).join('');
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
    if (data.token !== token || data.type !== 'mask-result') return;
    const request = pending.get(data.id);
    if (!request || request.type !== data.type) return;
    pending.delete(data.id);
    clearTimeout(request.timer);
    data.error ? request.reject(Object.assign(new Error(data.error), { code: data.code })) : request.resolve(data.result);
  });
  window.postMessage({ type: 'mask2ai-ready' }, location.origin);
  const rpc = (type, payload) => new Promise((resolve, reject) => {
    const id = requestPrefix + ':' + ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('AliasChat bridge did not respond'));
    }, 10000);
    pending.set(id, { resolve, reject, timer, type: type.replace('-request', '-result') });
    ready.then(() => {
      if (pending.has(id)) window.postMessage({ type, token, id, ...payload }, location.origin);
    });
  });

  const style = 'position:fixed;z-index:2147483647;font:13px/1.4 system-ui,sans-serif;color:#fff;background:#6b21a8;border-radius:8px;padding:6px 10px;box-shadow:0 2px 8px rgba(0,0,0,.3);pointer-events:none;';
  const show = (text, ms) => {
    const el = document.createElement('div');
    el.setAttribute('data-mask2ai', '');
    el.style.cssText = style + 'right:16px;bottom:16px;';
    el.textContent = '🛡 AliasChat: ' + text;
    (document.body || document.documentElement).appendChild(el);
    if (ms) setTimeout(() => el.remove(), ms);
  };
  const failure = error => show(error?.code === 'opaque-blocked'
    ? 'PDF/image uploads are blocked because they cannot be masked in the browser. You can allow them in AliasChat options (allowOpaqueUploads).'
    : error?.code === 'unknown-blocked'
      ? 'Unsupported file uploads are blocked because they cannot be inspected. You can allow them in AliasChat options (allowUnknownUploads).'
      : error?.code === 'encoding-blocked'
        ? 'File upload blocked because its text encoding could not be decoded safely. You can allow uninspected uploads in AliasChat options (allowUnknownUploads).'
        : error?.code === 'map-storage-error'
          ? error.message
          : 'could not mask personal data; request blocked', 6000);
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
    } else if ((isChatRequest(url) || isUploadMetadataRequest(url)) && body != null) {
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
    const result = await rpc('mask-request', { ...payload, via: 'content-script' });
    for (const name of result.warnings) show(name, 6000);
    if (result.count) show(`masked ${result.count} value${result.count === 1 ? '' : 's'} before sending`, 4000);
    return restore(result.body);
  };

  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    try {
      const url = input instanceof Request ? input.url : String(input);
      if (init && init.body != null) init = { ...init, body: await maskBody(url, init.body) };
      else if (input instanceof Request && input.body && (isChatRequest(url) || isUploadMetadataRequest(url))) input = new Request(input, { body: await maskBody(url, await input.clone().arrayBuffer()) });
    } catch (error) {
      failure(error);
      throw error;
    }
    return origFetch.call(this, input, init);
  };

  const proto = window.XMLHttpRequest.prototype;
  const open = proto.open;
  const send = proto.send;
  const abort = proto.abort;
  const states = new WeakMap();
  proto.open = function (method, url, async = true, ...args) {
    states.set(this, { url: String(url), async: async !== false, active: true });
    return open.call(this, method, url, async, ...args);
  };
  proto.send = function (body) {
    const state = states.get(this);
    if (!state) return send.call(this, body);
    const chat = isChatRequest(state.url) || isUploadMetadataRequest(state.url);
    if (!chat && !(body instanceof FormData) && !(body instanceof File)) return send.call(this, body);
    if (!state.async) {
      if (!chat) return send.call(this, body);
      failure();
      throw new Error('AliasChat requires asynchronous XMLHttpRequest for masking');
    }
    maskBody(state.url, body).then(masked => {
      if (state.active && states.get(this) === state) send.call(this, masked);
    }).catch(error => {
      if (!state.active || states.get(this) !== state) return;
      failure(error);
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
})();

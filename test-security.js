const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const { Worker } = require('worker_threads');
const { webcrypto } = require('crypto');
const { File } = require('buffer');
const pii = require('./core/pii.js');
const { rewrite } = require('./extension/rewrite.js');
const { validatePattern, validateExtras } = require('./extension/regex-validation.js');

const repeated = 'My name is Ali Veli. Ali Veli, ali veli, ALI VELI. XAli Veli, Ali Velix, Ali Veli_1.';
const names = {};
const maskedNames = pii.mask(repeated, names);
assert(maskedNames.includes('XAli Veli, Ali Velix, Ali Veli_1.'));
assert.strictEqual((maskedNames.match(/__PII_NAME_/g) || []).length, 4);
assert.strictEqual(pii.unmask(maskedNames, names), repeated);
pii.configure({ allow: ['Ali Veli'] });
assert.strictEqual(pii.mask('My name is Ali Veli. Ali Veli.', {}), 'My name is Ali Veli. Ali Veli.');
pii.configure({});
const unicodeNames = {};
const unicodeText = 'My name is İpek Şahin. İPEK ŞAHİN and İpek Şahin; Xİpek Şahin.';
assert(!pii.mask(unicodeText, unicodeNames).includes('and İpek Şahin;'));
assert.strictEqual(pii.unmask(pii.mask(unicodeText, {}), unicodeNames), unicodeText);

const card = prefix => {
  for (let digit = 0; digit < 10; digit++) if (pii.luhn(prefix + digit)) return prefix + digit;
};
const validCards = [card('622222222222222'), card('6222222222222222'), card('62222222222222222'), card('622222222222222222')];
const chinese = ['13800138000', '19911111111', '11010519491231002X', '11010519491231002x', ...validCards].join(' ');
const cnMap = {};
const cnMasked = pii.mask(chinese, cnMap);
assert.strictEqual(Object.keys(cnMap).length, 8);
assert.strictEqual(pii.unmask(cnMasked, cnMap), chinese);
assert(cnMasked.includes('__PII_PHONE_CN_') && cnMasked.includes('__PII_ID_CN_') && cnMasked.includes('__PII_CARD_CN_'));
const invalidCn = ['12800138000', '138001380001', '110105194912310020', '11010519491331002X', ...validCards.map(value => value.slice(0, -1) + (+value.at(-1) + 1) % 10)].join(' ');
assert.strictEqual(pii.mask(invalidCn, {}), invalidCn);
assert.strictEqual(pii.mask('王小明住在北京市朝阳区', {}), '王小明住在北京市朝阳区');
pii.configure({ disable: ['PHONE_CN', 'ID_CN', 'CARD_CN', 'CARD'] });
assert.strictEqual(pii.mask(chinese, {}), chinese);
pii.configure({});

const salted = {};
const first = pii.mask('jane.doe@example.com', salted, 'first-session');
assert(/^__PII_EMAIL_[0-9a-f]{12}__$/.test(first));
assert.strictEqual(first, pii.mask('jane.doe@example.com', {}, 'first-session'));
assert.notStrictEqual(first, pii.mask('jane.doe@example.com', {}, 'second-session'));
assert.strictEqual(pii.unmask(first, salted), 'jane.doe@example.com');
assert.strictEqual(pii.unmask('__PII_EMAIL_abcdef__', { __PII_EMAIL_abcdef__: 'legacy@example.com' }), 'legacy@example.com');
const collisionMap = {};
for (let i = 0; i < 1000; i++) pii.mask(`person${i}@example.com`, collisionMap, 'collision-test');
assert.strictEqual(Object.keys(collisionMap).length, 1000);

assert.throws(() => rewrite('state=' + encodeURIComponent('{\"prompt\":\"jane.doe@example.com\"}'), () => { throw new Error('mask failed'); }, {}), /mask failed/);

const workerSource = fs.readFileSync(require.resolve('./extension/regex-worker.js'), 'utf8');
const createWorker = () => {
  const worker = new Worker(`const { parentPort } = require('worker_threads'); global.self = { postMessage: data => parentPort.postMessage(data) }; parentPort.on('message', data => self.onmessage({ data })); ${workerSource}`, { eval: true });
  const adapter = { postMessage: data => worker.postMessage(data), terminate: () => worker.terminate() };
  worker.on('message', data => adapter.onmessage?.({ data }));
  worker.on('error', error => adapter.onerror?.(error));
  return adapter;
};

const delay = () => new Promise(resolve => setImmediate(resolve));
const until = async predicate => {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await delay();
  }
  throw new Error('Expected asynchronous operation did not complete');
};
const extension = (config = {}) => {
  const listeners = [];
  const messages = [];
  const requests = [];
  const toasts = [];
  const shared = { crypto: webcrypto, Uint8Array, ArrayBuffer, TextEncoder, TextDecoder, Request, Response, Blob, File, FormData, URLSearchParams, CompressionStream, DecompressionStream, Event, NodeFilter: { SHOW_TEXT: 4 }, clearTimeout, setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timer.unref(); return timer; } };
  let observer;
  let rejectUnmask = false;
  class XHR extends EventTarget {
    constructor() { super(); this.readyState = 0; this.responseType = ''; this.raw = ''; }
    get responseText() { if (this.responseType === 'json') throw new Error('InvalidStateError'); return this.raw; }
    get response() { return this.responseType === 'json' ? JSON.parse(this.raw) : this.raw; }
    open(method, url) { this.readyState = 1; this.url = url; this.dispatchEvent(new Event('readystatechange')); }
    send(body) {
      requests.push({ transport: 'xhr', url: this.url, body });
      this.raw = body;
      this.readyState = 4;
      for (const type of ['readystatechange', 'load', 'loadend']) this.dispatchEvent(new Event(type));
    }
    abort() { this.readyState = 0; }
  }
  const pageWindow = { XMLHttpRequest: XHR, fetch: async (input, init) => { requests.push({ transport: 'fetch', input, init }); return new Response('ok'); } };
  const bridgeWindow = {};
  const deliver = data => {
    for (const listener of listeners) listener.fn({ source: listener.window, data: structuredClone(data) });
  };
  for (const window of [pageWindow, bridgeWindow]) {
    window.addEventListener = (type, fn) => { if (type === 'message') listeners.push({ window, fn }); };
    window.postMessage = data => {
      messages.push(structuredClone(data));
      if (rejectUnmask && data.type === 'unmask-request') return queueMicrotask(() => deliver({ type: 'unmask-result', id: data.id, token: data.token, error: 'Restoration failed' }));
      queueMicrotask(() => deliver(data));
    };
  }
  const page = vm.createContext({ ...shared, window: pageWindow, document: {
    documentElement: { appendChild: el => toasts.push(el.textContent) },
    createElement: () => ({ setAttribute() {}, style: {}, remove() {} }),
    addEventListener() {},
    createTreeWalker: root => { let i = 0; return { nextNode: () => root.children[i++] }; }
  }, MutationObserver: class { constructor(fn) { observer = fn; } observe() {} } });
  const bridge = vm.createContext({ ...shared, window: bridgeWindow, chrome: { runtime: {}, storage: { sync: { get: (key, fn) => queueMicrotask(() => fn({ config })) } } } });
  const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
  for (const file of manifest.content_scripts[0].js) {
    vm.runInContext(fs.readFileSync(file, 'utf8'), page, { filename: file });
    if (page.piiRewrite) pageWindow.piiRewrite = page.piiRewrite;
  }
  for (const file of manifest.content_scripts[1].js) vm.runInContext(fs.readFileSync(file, 'utf8'), bridge, { filename: file });
  return { page: pageWindow, requests, messages, toasts, deliver, mutate: muts => observer(muts), failUnmask: value => { rejectUnmask = value; } };
};

(async () => {
  assert.throws(() => validatePattern({ pattern: '[' }, createWorker), SyntaxError);
  assert.throws(() => validatePattern({ pattern: 'a', flags: 'zz' }, createWorker), SyntaxError);
  await validateExtras({ extra: [{ pattern: 'EMP-\\d{6}' }, { pattern: '[a-z]+', flags: 'i' }] }, createWorker);
  await assert.rejects(validatePattern({ pattern: '(a+)+$' }, createWorker), /100ms safety limit/);
  const status = { textContent: '' };
  const area = { value: JSON.stringify({ extra: [{ pattern: '[' }] }) };
  let save;
  let saves = 0;
  vm.runInNewContext(fs.readFileSync('extension/options.js', 'utf8'), {
    mask2aiRegex: { validateExtras: cfg => validateExtras(cfg, createWorker) },
    document: { getElementById: id => id === 'config' ? area : id === 'status' ? status : { addEventListener: (type, fn) => { save = fn; } } },
    chrome: { storage: { sync: { get: (key, fn) => fn({}), set: (value, fn) => { saves++; fn(); } } } }
  });
  await save();
  assert(status.textContent.startsWith('Not saved:'));
  assert.strictEqual(saves, 0);
  area.value = JSON.stringify({ extra: [{ pattern: '(a+)+$' }] });
  await save();
  assert(status.textContent.includes('100ms safety limit'));
  assert.strictEqual(saves, 0);
  area.value = JSON.stringify({ extra: [{ pattern: 'EMP-\\d{6}' }] });
  await save();
  assert.strictEqual(saves, 1);

  const ext = extension();
  const url = 'https://chatgpt.com/backend-api/f/conversation';
  const body = JSON.stringify({ messages: [{ content: { parts: ['My name is Ali Veli. Ali Veli: jane.doe@example.com'] } }] });
  await ext.page.fetch(url, { method: 'POST', body });
  const wire = ext.requests[0].init.body;
  assert(!wire.includes('Ali Veli') && !wire.includes('jane.doe'));
  const placeholders = wire.match(/__PII_[A-Z_]+_[0-9a-f]{12}__/g);
  assert.strictEqual(placeholders.length, 3);
  assert.strictEqual(ext.page.pii, undefined);
  assert(!fs.readFileSync('extension/content.js', 'utf8').includes('sessionStorage'));
  assert(!ext.messages.some(message => 'map' in message || 'found' in (message.result || {})));
  const token = ext.messages.find(message => message.type === 'mask2ai-config').token;
  ext.deliver({ type: 'mask2ai-config', token, config: { disable: ['EMAIL', 'NAME'] } });
  ext.deliver({ type: 'mask2ai-config', token: 'f'.repeat(64), config: { disable: ['EMAIL', 'NAME'] } });
  await ext.page.fetch(url, { method: 'POST', body });
  assert.strictEqual(ext.requests[1].init.body, wire);
  const node = { nodeType: 3, data: placeholders.join(' '), parentElement: { closest: () => null } };
  await ext.mutate([{ type: 'characterData', target: node, addedNodes: [] }]);
  assert.strictEqual(node.data, 'Ali Veli Ali Veli jane.doe@example.com');
  ext.failUnmask(true);
  const nodes = [placeholders[0], placeholders[2]].map(data => ({ ...node, data }));
  await ext.mutate(nodes.map(target => ({ type: 'characterData', target, addedNodes: [] })));
  assert.deepStrictEqual(nodes.map(node => node.data), [placeholders[0], placeholders[2]]);
  ext.failUnmask(false);
  const xhr = new ext.page.XMLHttpRequest();
  xhr.open('POST', url);
  let completed = false;
  xhr.addEventListener('load', () => { assert.strictEqual(xhr.responseText, body); completed = true; });
  xhr.send(body);
  await until(() => completed);
  assert.strictEqual(ext.requests.at(-1).body, wire);
  const jsonXhr = new ext.page.XMLHttpRequest();
  jsonXhr.open('POST', url);
  jsonXhr.responseType = 'json';
  let jsonComplete = false;
  jsonXhr.addEventListener('load', () => {
    assert.strictEqual(JSON.stringify(jsonXhr.response), body);
    assert.throws(() => jsonXhr.responseText, /InvalidStateError/);
    jsonComplete = true;
  });
  jsonXhr.send(body);
  await until(() => jsonComplete);
  const beforeAbort = ext.requests.length;
  const cancelled = new ext.page.XMLHttpRequest();
  cancelled.open('POST', url);
  cancelled.send(body);
  cancelled.abort();
  await delay();
  await delay();
  assert.strictEqual(ext.requests.length, beforeAbort);
  const sync = new ext.page.XMLHttpRequest();
  sync.open('POST', url, false);
  assert.throws(() => sync.send(body), /asynchronous/);
  const syncUpload = new ext.page.XMLHttpRequest();
  syncUpload.open('POST', 'https://chatgpt.com/backend-api/upload', false);
  const syncForm = new FormData();
  syncForm.append('file', new File(['x'], 'a.txt', { type: 'text/plain' }));
  assert.doesNotThrow(() => syncUpload.send(syncForm));
  const unrelated = new ext.page.XMLHttpRequest();
  unrelated.open('POST', 'https://chatgpt.com/backend-api/me');
  unrelated.send('untouched');
  assert.strictEqual(unrelated.responseText, 'untouched');
  ext.failUnmask(true);
  const failedRestore = new ext.page.XMLHttpRequest();
  failedRestore.open('POST', url);
  let placeholdersKept = false;
  failedRestore.addEventListener('load', () => { assert.strictEqual(failedRestore.responseText, wire); placeholdersKept = true; });
  failedRestore.send(body);
  await until(() => placeholdersKept);
  ext.failUnmask(false);
  const editable = { ...node, data: placeholders[2], parentElement: { closest: () => true } };
  await ext.mutate([{ type: 'characterData', target: editable, addedNodes: [] }]);
  assert.strictEqual(editable.data, placeholders[2]);
  const textFile = new File(['jane.doe@example.com'], 'notes.txt', { type: 'text/plain' });
  const upload = new FormData();
  upload.append('file', textFile);
  upload.append('prompt', 'jane.doe@example.com');
  await ext.page.fetch(url, { method: 'POST', body: upload });
  const maskedUpload = ext.requests.at(-1).init.body;
  assert(/^__PII_EMAIL_[0-9a-f]{12}__$/.test(await maskedUpload.get('file').text()));
  assert.strictEqual(maskedUpload.get('file').name, 'notes.txt');
  assert(/^__PII_EMAIL_[0-9a-f]{12}__$/.test(maskedUpload.get('prompt')));
  await ext.page.fetch(url, { method: 'POST', body: new TextEncoder().encode(body) });
  assert.strictEqual(new TextDecoder().decode(ext.requests.at(-1).init.body), wire);
  const compressed = await new Response(new Blob([body]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  await ext.page.fetch(url, { method: 'POST', body: new Uint8Array(compressed) });
  const compressedWire = ext.requests.at(-1).init.body;
  assert.strictEqual(await new Response(new Blob([compressedWire]).stream().pipeThrough(new DecompressionStream('gzip'))).text(), wire);
  const params = new URLSearchParams({ prompt: 'jane.doe@example.com', token: 'unchanged' });
  await ext.page.fetch(url, { method: 'POST', body: params });
  assert.strictEqual(ext.requests.at(-1).init.body.get('token'), 'unchanged');
  assert(/^__PII_EMAIL_[0-9a-f]{12}__$/.test(ext.requests.at(-1).init.body.get('prompt')));
  await ext.page.fetch(new Request(url, { method: 'POST', body }));
  assert.strictEqual(await ext.requests.at(-1).input.text(), wire);
  const firstNode = { ...node, data: placeholders[0] };
  let secondData = placeholders[2];
  const secondNode = { ...node, get data() { return secondData; }, set data(value) { if (value === 'jane.doe@example.com') throw new Error('DOM update failed'); secondData = value; } };
  await ext.mutate([firstNode, secondNode].map(target => ({ type: 'characterData', target, addedNodes: [] })));
  assert.strictEqual(firstNode.data, placeholders[0]);
  assert.strictEqual(secondNode.data, placeholders[2]);
  const staleNode = { ...node, data: placeholders[2] };
  const restoration = ext.mutate([{ type: 'characterData', target: staleNode, addedNodes: [] }]);
  staleNode.data = 'new content';
  await restoration;
  assert.strictEqual(staleNode.data, 'new content');
  const requestCount = ext.requests.length;
  await assert.rejects(ext.page.fetch(url, { method: 'POST', body: '{invalid json' }));
  assert.strictEqual(ext.requests.length, requestCount);
  assert(ext.toasts.some(text => text.includes('request blocked')));
  const malformedForm = 'payload=' + encodeURIComponent('{"prompt":"jane.doe@example.com"}');
  const badConfig = extension({ extra: [{ pattern: '[' }] });
  await assert.rejects(badConfig.page.fetch(url, { method: 'POST', body: malformedForm }));
  assert.strictEqual(badConfig.requests.length, 0);
  const failedXhr = new badConfig.page.XMLHttpRequest();
  failedXhr.open('POST', url);
  let failed = false;
  failedXhr.addEventListener('error', () => { failed = true; });
  failedXhr.send(body);
  await until(() => failed);
  assert.strictEqual(badConfig.requests.length, 0);
  const secondSession = extension();
  await secondSession.page.fetch(url, { method: 'POST', body });
  assert.notStrictEqual(secondSession.requests[0].init.body, wire);
  ext.deliver({ type: 'map-clear', token, id: 'clear-test' });
  await until(() => ext.messages.some(message => message.type === 'map-cleared' && message.result));
  node.data = placeholders[2];
  await ext.mutate([{ type: 'characterData', target: node, addedNodes: [] }]);
  assert.strictEqual(node.data, placeholders[2]);
  console.log('security ok');
})().catch(error => { console.error(error); process.exitCode = 1; });
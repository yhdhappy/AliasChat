const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const { Worker } = require('worker_threads');
const { webcrypto, createHmac, randomBytes } = require('crypto');
const { File } = require('buffer');
const { execFile } = require('child_process');
const { promisify } = require('util');
const runFile = promisify(execFile);
const pii = require('./core/pii.js');
const { rewrite } = require('./extension/rewrite.js');
const { validatePattern, validateExtras } = require('./extension/regex-validation.js');

const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
assert.strictEqual(manifest.version, require('./package.json').version);
assert.strictEqual(manifest.version, require('./.claude-plugin/plugin.json').version);
const stoplistSource = fs.readFileSync('core/pii.js', 'utf8').match(/const NAME_STOPLIST = new Set\('([^']+)'\.split\(' '\)\)/);
assert(stoplistSource, 'NAME_STOPLIST declaration must be found');
const stoplist = stoplistSource[1].split(' ');
assert.strictEqual(new Set(stoplist).size, stoplist.length, 'NAME_STOPLIST must not contain duplicates');
for (const name of ['Reed', 'Clay', 'Stone', 'Ford', 'Banks', 'Cook', 'Hunter', 'Fisher', 'Mason', 'Carter', 'Cooper', 'Parker', 'Porter', 'Taylor', 'Weaver', 'Bailey']) {
  const values = { __PII_NAME_abcdef123456__: name };
  const text = `${name} ${name.toLowerCase()} ${name.toUpperCase()}`;
  const masked = pii.mask(text, values);
  assert(/^__PII_NAME_[0-9a-f]{12}__ /.test(masked), `${name} must be masked on repetition`);
  assert(masked.endsWith(` ${name.toLowerCase()} ${name.toUpperCase()}`));
  assert.strictEqual(pii.unmask(masked, values), text);
}
for (const name of ['Will', 'May', 'Mark', 'Grace', 'Bill', 'Chase', 'Penny', 'Amber', 'Crystal', 'Summer', 'Autumn']) {
  assert.strictEqual(pii.mask(name, { __PII_NAME_abcdef123456__: name }), name);
}
if (manifest.background) {
  const files = [...new Set(manifest.content_scripts.flatMap(script => script.js))];
  const background = fs.readFileSync(manifest.background.service_worker, 'utf8');
  assert(!background.includes('TRUSTED_AND_UNTRUSTED_CONTEXTS'), 'Session storage must not be exposed to untrusted contexts');
  assert(!background.includes('chrome.storage.session.setAccessLevel'), 'Session storage must retain its default trusted-context access level');
}

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

for (const text of ['a'.repeat(40000), 'a@' + 'a.'.repeat(20000) + '1', 'a@' + 'a'.repeat(40000)]) {
  const start = performance.now();
  assert.strictEqual(pii.mask(text, {}), text);
  assert(performance.now() - start < 200, 'Long non-email text must be processed in under 200ms');
}
for (const email of ['a+b.c_d%z@example.co.uk', 'A@sub-domain.example.COM']) {
  const values = {};
  assert(/^__PII_EMAIL_[0-9a-f]{12}__$/.test(pii.mask(email, values)));
  assert.deepStrictEqual(Object.values(values), [email]);
}
const legacyEmailPattern = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
for (const text of ['alice@x.com-bob@y.com', 'alice@x.com_bob@y.com', 'alice@x.com bob@y.com']) {
  const expected = [...text.matchAll(legacyEmailPattern)].map(match => match[0].replace(/^[-_]/, ''));
  const values = {};
  const masked = pii.mask(text, values);
  assert.deepStrictEqual(Object.values(values), expected, `${text} should retain every legacy email detection`);
  for (const email of expected) assert(!masked.includes(email), `${email} leaked from ${text}`);
}
for (const text of ['a@example..com', 'a@example.c', 'a@.example.com']) assert.strictEqual(pii.mask(text, {}), text);
assert(pii.mask('a@example.com123', {}).endsWith('123'));

pii.configure({ allow: ['a@example.com'] });
assert.strictEqual(pii.mask('a@example.com123', {}), 'a@example.com123');
pii.configure({});

const salted = {};
const firstKey = randomBytes(32);
const firstTokenizer = pii.createTokenizer(firstKey);
const first = pii.mask('jane.doe@example.com', salted, firstTokenizer);
assert.strictEqual(first, `__PII_EMAIL_${createHmac('sha256', firstKey).update('jane.doe@example.com').digest('hex').slice(0, 12)}__`);
assert(/^__PII_EMAIL_[0-9a-f]{12}__$/.test(first));
assert.strictEqual(first, pii.mask('jane.doe@example.com', {}, firstTokenizer));
assert.notStrictEqual(first, pii.mask('jane.doe@example.com', {}, pii.createTokenizer(randomBytes(32))));
assert.strictEqual(pii.unmask(first, salted), 'jane.doe@example.com');
assert.strictEqual(pii.unmask('__PII_EMAIL_abcdef__', { __PII_EMAIL_abcdef__: 'legacy@example.com' }), 'legacy@example.com');
const collisionMap = {};
for (let i = 0; i < 1000; i++) pii.mask(`person${i}@example.com`, collisionMap, firstTokenizer);
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
const extension = (config = {}, sessionStore = {}, failDigests = false, failFirstImport = false) => {
  const listeners = [];
  const messages = [];
  const runtimeRequests = [];
  const requests = [];
  const toasts = [];
  const shared = { crypto: webcrypto, Uint8Array, ArrayBuffer, TextEncoder, TextDecoder, Request, Response, Blob, File, FormData, URLSearchParams, CompressionStream, DecompressionStream, Event, NodeFilter: { SHOW_TEXT: 4 }, clearTimeout, setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timer.unref(); return timer; } };
  let observer;
  let bridgeObserver;
  let bridgeMaskCalls = 0;
  let installedListener;
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
      queueMicrotask(() => deliver(data));
    };
  }
  const page = vm.createContext({ ...shared, window: pageWindow, document: {
    documentElement: { appendChild: el => toasts.push(el.textContent) },
    createElement: () => ({ setAttribute() {}, style: {}, remove() {} }),
    addEventListener() {},
    createTreeWalker: root => { let i = 0; return { nextNode: () => root.children[i++] }; }
  }, MutationObserver: class { constructor(fn) { observer = fn; } observe() {} } });
  let workerListener;
  let importFailures = failFirstImport ? 1 : 0;
  const session = { get: async key => ({ [key]: sessionStore[key] }), set: async obj => { Object.assign(sessionStore, structuredClone(obj)); }, setAccessLevel: async () => {}, clear: async () => { for (const key of Object.keys(sessionStore)) delete sessionStore[key]; } };
  const restartBackground = () => vm.runInNewContext(fs.readFileSync('extension/background.js', 'utf8'), {
    crypto: {
      getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
      subtle: {
        importKey: (...args) => importFailures-- > 0 ? Promise.reject(new Error('Temporary key import failure')) : webcrypto.subtle.importKey(...args),
        sign: (...args) => webcrypto.subtle.sign(...args)
      }
    }, Uint8Array, TextEncoder,
    chrome: { storage: { session }, runtime: { id: 'privy-test', onStartup: { addListener() {} }, onInstalled: { addListener: fn => { installedListener = fn; } }, onMessage: { addListener: fn => { workerListener = fn; } } } }
  });
  restartBackground();
  const bridge = vm.createContext({ ...shared, window: bridgeWindow, document: {
    documentElement: {},
    createTreeWalker: root => { let i = 0; return { nextNode: () => root.children[i++] }; }
  }, MutationObserver: class { constructor(fn) { bridgeObserver = fn; } observe() {} }, chrome: { runtime: { sendMessage: message => {
    runtimeRequests.push(structuredClone(message));
    if (failDigests && message.type === 'privy-digests') return Promise.reject(new Error('Worker unavailable'));
    return new Promise(resolve => workerListener(structuredClone(message), { id: 'privy-test' }, resolve));
  } }, storage: { sync: { get: (key, fn) => queueMicrotask(() => fn({ config })) }, session } } });
  const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
  for (const file of manifest.content_scripts[0].js) {
    vm.runInContext(fs.readFileSync(file, 'utf8'), page, { filename: file });
    if (page.piiRewrite) pageWindow.piiRewrite = page.piiRewrite;
  }
  for (const file of manifest.content_scripts[1].js) {
    if (file === 'extension/bridge.js') {
      bridge.pii.mask = (...args) => { bridgeMaskCalls++; return pii.mask(...args); };
    }
    vm.runInContext(fs.readFileSync(file, 'utf8'), bridge, { filename: file });
  }
  return { page: pageWindow, requests, messages, runtimeRequests, toasts, deliver, sessionStore, restartBackground, installed: details => installedListener(details), mutate: muts => bridgeObserver(muts), get bridgeMaskCalls() { return bridgeMaskCalls; } };
};

(async () => {
  await runFile('sh', ['scripts/pack-extension.sh']);
  const archive = `dist/privyAI-extension-${manifest.version}.zip`;
  const archiveFiles = (await runFile('unzip', ['-Z1', archive])).stdout.trim().split('\n');
  for (const file of ['extension/background.js', 'extension/welcome.html', 'extension/welcome.js']) {
    assert(archiveFiles.includes(file), `Extension archive must include ${file}`);
    assert.strictEqual((await runFile('unzip', ['-p', archive, file])).stdout, fs.readFileSync(file, 'utf8'));
  }
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

  const cleanExt = extension();
  const url = 'https://chatgpt.com/backend-api/f/conversation';
  const callsBeforeClean = cleanExt.bridgeMaskCalls;
  await cleanExt.page.fetch(url, { method: 'POST', body: JSON.stringify({ prompt: 'no personal data here' }) });
  assert.strictEqual(cleanExt.bridgeMaskCalls - callsBeforeClean, 1, 'A clean body should be masked in one pass');
  const updateProbe = extension();
  await updateProbe.page.fetch(url, { method: 'POST', body: JSON.stringify({ prompt: 'contact first@example.com' }) });
  const installedKey = [...updateProbe.sessionStore.privyKey];
  await updateProbe.installed({ reason: 'update' });
  await updateProbe.page.fetch(url, { method: 'POST', body: JSON.stringify({ prompt: 'contact first@example.com' }) });
  assert.strictEqual(updateProbe.sessionStore.privyKey.length, 32, 'An update must save the replacement key to session storage');
  assert.notDeepStrictEqual(updateProbe.sessionStore.privyKey, installedKey, 'An update must rotate the key after clearing session storage');
  const retryWorker = extension({}, {}, false, true);
  await assert.rejects(retryWorker.page.fetch(url, { method: 'POST', body: JSON.stringify({ prompt: 'contact retry@example.com' }) }));
  await retryWorker.page.fetch(url, { method: 'POST', body: JSON.stringify({ prompt: 'contact retry@example.com' }) });
  const ext = extension();
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
  assert.strictEqual(ext.sessionStore.privyKey.length, 32);
  const expectedEmail = createHmac('sha256', Buffer.from(ext.sessionStore.privyKey)).update('jane.doe@example.com').digest('hex').slice(0, 12);
  assert(wire.includes(`__PII_EMAIL_${expectedEmail}__`));
  assert(!JSON.stringify(ext.messages).includes(JSON.stringify(ext.sessionStore.privyKey)));
  assert(ext.runtimeRequests.some(message => message.type === 'privy-map-get') && ext.runtimeRequests.some(message => message.type === 'privy-map-set'));
  assert(!JSON.stringify(ext.runtimeRequests).includes(JSON.stringify(ext.sessionStore.privyKey)));
  assert(!ext.messages.some(message => 'salt' in message || 'key' in message || 'privyKey' in message));
  ext.restartBackground();
  await ext.page.fetch(url, { method: 'POST', body });
  assert.strictEqual(ext.requests.at(-1).init.body, wire);
  const refreshed = extension({}, ext.sessionStore);
  await refreshed.page.fetch(url, { method: 'POST', body });
  assert.strictEqual(refreshed.requests[0].init.body, wire);
  const freshSession = extension();
  await freshSession.page.fetch(url, { method: 'POST', body });
  assert.notStrictEqual(freshSession.requests[0].init.body, wire);
  ext.sessionStore.privyMap.__PII_EMAIL_abcdef__ = 'legacy@example.com';
  ext.sessionStore.privyMap.__PII_EMAIL_abcdef123456__ = 'old@example.com';
  const legacyNode = { nodeType: 3, data: '__PII_EMAIL_abcdef__ __PII_EMAIL_abcdef123456__', parentElement: { closest: () => null } };
  await refreshed.mutate([{ type: 'characterData', target: legacyNode, addedNodes: [] }]);
  assert.strictEqual(legacyNode.data, 'legacy@example.com old@example.com');
  const beforeUnmaskProbe = ext.messages.length;
  ext.deliver({ type: 'unmask-request', token, id: 'page-probe', body: placeholders[2] });
  await delay();
  assert.strictEqual(ext.messages.length, beforeUnmaskProbe);
  const unavailableWorker = extension({}, {}, true);
  await assert.rejects(unavailableWorker.page.fetch(url, { method: 'POST', body }));
  assert.strictEqual(unavailableWorker.requests.length, 0);
  const node = { nodeType: 3, data: placeholders.join(' '), parentElement: { closest: () => null } };
  await ext.mutate([{ type: 'characterData', target: node, addedNodes: [] }]);
  assert.strictEqual(node.data, 'Ali Veli Ali Veli jane.doe@example.com');
  const xhr = new ext.page.XMLHttpRequest();
  xhr.open('POST', url);
  let completed = false;
  xhr.addEventListener('load', () => { assert.strictEqual(xhr.responseText, wire); completed = true; });
  xhr.send(body);
  await delay();
  await until(() => completed);
  assert.strictEqual(ext.requests.at(-1).body, wire);
  const jsonXhr = new ext.page.XMLHttpRequest();
  jsonXhr.open('POST', url);
  jsonXhr.responseType = 'json';
  let jsonComplete = false;
  jsonXhr.addEventListener('load', () => {
    assert.strictEqual(JSON.stringify(jsonXhr.response), wire);
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
  const failedRestore = new ext.page.XMLHttpRequest();
  failedRestore.open('POST', url);
  let placeholdersKept = false;
  failedRestore.addEventListener('load', () => { assert.strictEqual(failedRestore.responseText, wire); placeholdersKept = true; });
  failedRestore.send(body);
  await until(() => placeholdersKept);
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
  assert(ext.toasts.includes('🛡 PrivyAI: could not mask personal data; request blocked'));
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
  const opaqueToast = '🛡 PrivyAI: PDF/image uploads are blocked because they cannot be masked in the browser. You can allow them in PrivyAI options (allowOpaqueUploads).';
  const blockedUpload = extension();
  const pdf = new File(['%PDF-1.7'], 'private.pdf', { type: 'application/pdf' });
  const pdfForm = new FormData();
  pdfForm.append('file', pdf);
  await assert.rejects(blockedUpload.page.fetch(url, { method: 'POST', body: pdfForm }), error => error.code === 'opaque-blocked');
  assert.strictEqual(blockedUpload.requests.length, 0);
  assert(blockedUpload.messages.some(message => message.type === 'mask-result' && message.code === 'opaque-blocked'));
  assert.deepStrictEqual(blockedUpload.toasts, [opaqueToast]);
  const imageXhr = new blockedUpload.page.XMLHttpRequest();
  imageXhr.open('POST', url);
  let imageBlocked = false;
  imageXhr.addEventListener('error', () => { imageBlocked = true; });
  imageXhr.send(new File(['image bytes'], 'private.png', { type: 'image/png' }));
  await until(() => imageBlocked);
  assert.strictEqual(blockedUpload.requests.length, 0);
  assert.deepStrictEqual(blockedUpload.toasts, [opaqueToast, opaqueToast]);
  const allowedUpload = extension({ allowOpaqueUploads: true });
  await allowedUpload.page.fetch(url, { method: 'POST', body: pdfForm });
  assert.strictEqual(allowedUpload.requests.length, 1);
  assert.strictEqual(await allowedUpload.requests[0].init.body.get('file').text(), '%PDF-1.7');
  assert(allowedUpload.toasts.some(text => text.includes('uploaded uninspected')));
  const secondSession = extension();
  await secondSession.page.fetch(url, { method: 'POST', body });
  assert.notStrictEqual(secondSession.requests[0].init.body, wire);
  ext.deliver({ type: 'map-clear', token, id: 'clear-test' });
  await delay();
  await delay();
  assert(!ext.messages.some(message => message.type === 'map-cleared'));
  node.data = placeholders[2];
  await ext.mutate([{ type: 'characterData', target: node, addedNodes: [] }]);
  assert.strictEqual(node.data, 'jane.doe@example.com');
  console.log('security ok');
})().catch(error => { console.error(error); process.exitCode = 1; });

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

const { maskFileName } = require('./extension/files.js');
for (const name of ['Quarterly Financial Report.docx', 'Annual-Budget-Plan.xlsx', 'Project Alpha Roadmap.pptx', 'john smith passport.png', 'John_Smith_passport.pdf', 'Name: John Smith.txt']) {
  const found = { __PII_EMAIL_abcdef123456__: 'existing@example.com' };
  assert.strictEqual(maskFileName(name, pii.mask, found), name);
  assert.deepStrictEqual(found, { __PII_EMAIL_abcdef123456__: 'existing@example.com' });
}
for (const [name, pattern, value] of [
  ['Jane Doe jane.doe@example.com.DoCx', /^Jane Doe __PII_EMAIL_[0-9a-f]{12}__\.DoCx$/, 'jane.doe@example.com'],
  ['Name: John Smith; 13800138000.XlSx', /^Name: John Smith; __PII_PHONE_CN_[0-9a-f]{12}__\.XlSx$/, '13800138000']
]) {
  const found = {};
  assert(pattern.test(maskFileName(name, pii.mask, found)), name);
  assert.deepStrictEqual(Object.values(found), [value]);
}
{
  const found = {};
  pii.mask('repeated@example.com', found);
  const existing = { ...found };
  assert(/^__PII_EMAIL_[0-9a-f]{12}__\.txt$/.test(maskFileName('repeated@example.com.txt', pii.mask, found)));
  assert.deepStrictEqual(found, existing);
}
{
  const found = {};
  pii.mask('Name: John Smith', found);
  const existing = { ...found };
  assert.strictEqual(maskFileName('john smith passport.png', pii.mask, found), 'john smith passport.png');
  assert.deepStrictEqual(found, existing);
  assert(/^John Smith __PII_PHONE_CN_[0-9a-f]{12}__\.PNG$/.test(maskFileName('John Smith 13800138000.PNG', pii.mask, found)));
  assert.deepStrictEqual(Object.entries(found).filter(([key]) => key.startsWith('__PII_NAME_')), Object.entries(existing));
}

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

const base64urlText = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'.repeat(625);
for (const text of ['a'.repeat(40000), '-'.repeat(40000), '_'.repeat(40000), base64urlText, 'a@' + 'a.'.repeat(20000) + '1', 'a@' + 'a'.repeat(40000), '@' + '-'.repeat(40000), 'a@' + '-'.repeat(40000), 'a@' + '-.'.repeat(20000) + '1']) {
  const start = performance.now();
  const masked = pii.mask(text, {});
  const elapsed = performance.now() - start;
  assert.strictEqual(masked, text);
  assert(elapsed < 200, `Long non-email text must be processed in under 200ms (took ${elapsed.toFixed(2)}ms)`);
}
for (const email of ['test@example.com', 'a-b_c.d+e@x.co', '-test@example.com', '_test@example.com', '--__test@example.com', 'a+b.c_d%z@example.co.uk', 'A@sub-domain.example.COM']) {
  const values = {};
  assert(/^__PII_EMAIL_[0-9a-f]{12}__$/.test(pii.mask(email, values)));
  assert.deepStrictEqual(Object.values(values), [email]);
}
{
  const text = 'a@b.com,c@d.com;e@f.org';
  const values = {};
  const masked = pii.mask(text, values);
  assert.deepStrictEqual(Object.values(values), ['a@b.com', 'c@d.com', 'e@f.org']);
  assert.strictEqual((masked.match(/__PII_EMAIL_/g) || []).length, 3);
  assert.strictEqual(pii.unmask(masked, values), text);
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
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay();
  }
  throw new Error('Expected asynchronous operation did not complete');
};
const extension = (config = {}, sessionStore = {}, failDigests = false, failFirstImport = false, fakeUnmaskTimers = false) => {
  const listeners = [];
  const messages = [];
  const postMessages = [];
  const runtimeRequests = [];
  const importedExtractable = [];
  const requests = [];
  const toasts = [];
  let now = 0;
  const unmaskTimers = [];
  const shared = { location: { origin: 'https://chatgpt.com' }, performance: { now: () => now }, crypto: webcrypto, MessageChannel: class { constructor() { const deliverTo = port => data => queueMicrotask(() => port.onmessage && port.onmessage({ data })); this.port1 = { postMessage: null, onmessage: null }; this.port2 = { postMessage: null, onmessage: null }; this.port1.postMessage = deliverTo(this.port2); this.port2.postMessage = deliverTo(this.port1); } }, Uint8Array, ArrayBuffer, TextEncoder, TextDecoder, Request, Response, Blob, File, FormData, URLSearchParams, CompressionStream, DecompressionStream, Event, NodeFilter: { SHOW_TEXT: 4 }, clearTimeout, setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timer.unref(); return timer; } };
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
  const deliver = (data, transfer) => {
    for (const listener of listeners) listener.fn({ source: listener.window, data: structuredClone(data), ports: transfer || [] });
  };
  for (const window of [pageWindow, bridgeWindow]) {
    window.addEventListener = (type, fn) => { if (type === 'message') listeners.push({ window, fn }); };
    window.postMessage = (data, targetOrigin, transfer) => {
      messages.push(structuredClone(data));
      postMessages.push({ data: structuredClone(data), targetOrigin });
      queueMicrotask(() => deliver(data, transfer));
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
  const session = { get: async key => typeof key === 'string' ? ({ [key]: sessionStore[key] }) : Object.fromEntries(key.map(name => [name, sessionStore[name]])), set: async obj => { Object.assign(sessionStore, structuredClone(obj)); }, remove: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) delete sessionStore[key]; }, setAccessLevel: async () => {}, clear: async () => { for (const key of Object.keys(sessionStore)) delete sessionStore[key]; } };
  const restartBackground = () => vm.runInNewContext(fs.readFileSync('extension/background.js', 'utf8'), {
    crypto: {
      getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
      subtle: {
        importKey: (...args) => {
          importedExtractable.push(args[3]);
          return importFailures-- > 0 ? Promise.reject(new Error('Temporary key import failure')) : webcrypto.subtle.importKey(...args);
        },
        sign: (...args) => webcrypto.subtle.sign(...args)
      }
    }, Uint8Array, TextEncoder,
    chrome: { storage: { session }, runtime: { id: 'privy-test', onStartup: { addListener() {} }, onInstalled: { addListener: fn => { installedListener = fn; } }, onMessage: { addListener: fn => { workerListener = fn; } } } }
  });
  restartBackground();
  const sendWorker = message => new Promise(resolve => workerListener(structuredClone(message), { id: 'privy-test' }, resolve));
  const bridge = vm.createContext({ ...shared, Date: class extends Date { static now() { return now; } }, ...(fakeUnmaskTimers ? { setTimeout: (fn, ms) => { const timer = { fn, at: now + ms }; unmaskTimers.push(timer); return timer; } } : {}), window: bridgeWindow, document: {
    documentElement: {},
    createTreeWalker: root => { let i = 0; return { nextNode: () => root.children[i++] }; }
  }, MutationObserver: class { constructor(fn) { bridgeObserver = fn; } observe() {} }, chrome: { runtime: { sendMessage: message => {
    runtimeRequests.push(structuredClone(message));
    if (failDigests && message.type === 'privy-digests') return Promise.reject(new Error('Worker unavailable'));
    return sendWorker(message);
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
  return { page: pageWindow, requests, messages, postMessages, runtimeRequests, importedExtractable, toasts, deliver, sessionStore, sendWorker, restartBackground, advanceTime: ms => { now += ms; }, runUnmaskTimers: async () => { for (const timer of unmaskTimers.splice(0)) { if (timer.at <= now) await timer.fn(); else unmaskTimers.push(timer); } }, installed: details => installedListener(details), mutate: muts => bridgeObserver(muts), get bridgeMaskCalls() { return bridgeMaskCalls; } };
};

(async () => {
  const restorePlaceholder = '__PII_EMAIL_abcdef123456__';
  const restore = extension({}, { aliasMap: { [restorePlaceholder]: 'late@example.com' } }, false, false, true);
  const textNode = data => ({ nodeType: 3, data, parentElement: { closest: () => false } });
  const mutation = target => [{ type: 'characterData', target, addedNodes: [] }];
  for (let i = 0; i < 10; i++) {
    const target = textNode(restorePlaceholder);
    await restore.mutate(mutation(target));
    assert.strictEqual(target.data, 'late@example.com');
  }
  restore.advanceTime(250);
  const deferred = textNode(restorePlaceholder);
  await restore.mutate(mutation(deferred));
  assert.strictEqual(deferred.data, restorePlaceholder);
  restore.advanceTime(749);
  await restore.runUnmaskTimers();
  assert.strictEqual(deferred.data, restorePlaceholder);
  restore.advanceTime(1);
  await restore.runUnmaskTimers();
  await until(() => deferred.data === 'late@example.com');
  const late = extension({}, {}, false, false, true);
  const missing = textNode(restorePlaceholder);
  await late.mutate(mutation(missing));
  const alsoMissing = textNode(restorePlaceholder);
  await late.mutate(mutation(alsoMissing));
  late.advanceTime(29999);
  await late.runUnmaskTimers();
  assert.strictEqual(missing.data, restorePlaceholder);
  late.advanceTime(1);
  late.sessionStore.aliasMap = { [restorePlaceholder]: 'late@example.com' };
  await late.runUnmaskTimers();
  await until(() => missing.data === 'late@example.com' && alsoMissing.data === 'late@example.com');
  await runFile('sh', ['scripts/pack-extension.sh']);
  const archive = `dist/aliaschat-extension-${manifest.version}.zip`;
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
  const limited = extension();
  const limitedToken = limited.messages.find(message => message.type === 'mask2ai-config').token;
  const limitError = 'AliasChat is handling too many masking requests; please wait a moment and resend.';
  const probe = id => limited.deliver({ type: 'mask-request', token: limitedToken, id, format: 'chat', body: JSON.stringify({ prompt: 'probe@example.com' }) });
  const replies = () => limited.messages.filter(message => message.type === 'mask-result');
  for (let i = 0; i < 15; i++) probe(`burst-${i}`);
  await until(() => replies().length === 15);
  for (let i = 0; i < 15; i++) {
    const reply = replies().find(message => message.id === `burst-${i}`);
    assert.strictEqual(reply.token, limitedToken);
    if (i < 10) {
      assert(reply.result.body.includes('__PII_EMAIL_'));
      assert.strictEqual(reply.error, undefined);
    } else {
      assert.strictEqual(reply.error, limitError);
      assert.strictEqual(reply.result, undefined);
    }
  }
  assert.strictEqual(limited.bridgeMaskCalls, 20, 'Only ten accepted requests may run the two masking passes');
  assert.strictEqual(limited.runtimeRequests.filter(message => message.type === 'privy-digests').length, 10);
  await limited.page.fetch(url, { method: 'POST', body: JSON.stringify({ prompt: 'sent@example.com' }) });
  assert.strictEqual(limited.requests.length, 1, 'Page probes must not exhaust the content request bucket');
  assert(limited.requests[0].init.body.includes('__PII_EMAIL_'));
  const callsAtLimit = limited.bridgeMaskCalls;
  const runtimeAtLimit = limited.runtimeRequests.length;
  limited.advanceTime(999);
  probe('too-soon');
  assert.strictEqual(replies().find(message => message.id === 'too-soon').error, limitError);
  assert.strictEqual(limited.bridgeMaskCalls, callsAtLimit);
  assert.strictEqual(limited.runtimeRequests.length, runtimeAtLimit, 'Rejected requests must not invoke the worker');
  limited.advanceTime(1);
  probe('one-refilled');
  await until(() => replies().some(message => message.id === 'one-refilled' && message.result));
  probe('refill-spent');
  assert.strictEqual(replies().find(message => message.id === 'refill-spent').error, limitError);
  limited.advanceTime(10000);
  for (let i = 0; i < 11; i++) probe(`refilled-${i}`);
  await until(() => replies().filter(message => message.id.startsWith('refilled-')).length === 11);
  assert.strictEqual(replies().filter(message => message.id.startsWith('refilled-') && message.result).length, 10);
  assert.strictEqual(replies().find(message => message.id === 'refilled-10').error, limitError);
  const batchUpload = extension();
  await Promise.all(Array.from({ length: 20 }, (_, i) => batchUpload.page.fetch(url, {
    method: 'POST', body: new File(['jane.doe@example.com,13800138000'], `batch-${i}.csv`)
  })));
  assert.strictEqual(batchUpload.requests.length, 20);
  for (const request of batchUpload.requests) {
    const text = await request.init.body.text();
    assert(text.includes('__PII_EMAIL_') && text.includes('__PII_PHONE_CN_'));
    assert(!text.includes('jane.doe@example.com') && !text.includes('13800138000'));
  }
  assert(!batchUpload.toasts.some(text => text.includes('too many') || text.includes('request blocked')));
  assert(batchUpload.messages.filter(message => message.type === 'mask-request').every(message => message.via === 'content-script'));
  const contentLimit = extension();
  await Promise.all(Array.from({ length: 50 }, () => contentLimit.page.fetch(url, { method: 'POST', body: '{"prompt":"hello"}' })));
  await assert.rejects(contentLimit.page.fetch(url, { method: 'POST', body: '{"prompt":"hello"}' }), { message: limitError });
  contentLimit.advanceTime(99);
  await assert.rejects(contentLimit.page.fetch(url, { method: 'POST', body: '{"prompt":"hello"}' }), { message: limitError });
  contentLimit.advanceTime(1);
  await contentLimit.page.fetch(url, { method: 'POST', body: '{"prompt":"hello"}' });
  assert.strictEqual(contentLimit.requests.length, 51);
  for (const file of ['extension/content.js', 'extension/bridge.js']) {
    assert(!/postMessage\([^\n]*,\s*['"]\*['"]\)/.test(fs.readFileSync(file, 'utf8')), `${file} must not post to a wildcard origin`);
  }
  for (const { data, targetOrigin } of limited.postMessages) {
    assert.strictEqual(targetOrigin, 'https://chatgpt.com', `Unexpected target origin for ${data.type}`);
  }
  const callsBeforeClean = cleanExt.bridgeMaskCalls;
  await cleanExt.page.fetch(url, { method: 'POST', body: JSON.stringify({ prompt: 'no personal data here' }) });
  assert.strictEqual(cleanExt.bridgeMaskCalls - callsBeforeClean, 1, 'A clean body should be masked in one pass');
  const coverageExt = extension();
  const coverageBody = {
    message_content: 'contact coverage@example.com',
    file_name: 'coverage@example.com.txt',
    attachments: [{ name: 'coverage@example.com.pdf', metadata: { name: 'coverage@example.com' } }, null, { name: 42 }],
    model: { name: 'coverage@example.com' },
    metadata: { attachments: { name: 'coverage@example.com' } }
  };
  for (const coverageUrl of [
    'https://claude.ai/api/organizations/o1/chat_conversations/c1/retry_completion',
    'https://chatgpt.com/backend-api/conversation/c1/title',
    'https://claude.ai/api/organizations/o1/chat_conversations/550e8400-e29b-41d4-a716-446655440000'
  ]) {
    await coverageExt.page.fetch(coverageUrl, { method: 'POST', body: JSON.stringify(coverageBody) });
    const rewritten = JSON.parse(coverageExt.requests.at(-1).init.body);
    for (const value of [rewritten.message_content, rewritten.file_name, rewritten.attachments[0].name]) {
      assert(value.includes('__PII_EMAIL_') && !value.includes('coverage@example.com'), value);
    }
    assert.deepStrictEqual(rewritten.attachments.slice(1), [null, { name: 42 }]);
    assert.deepStrictEqual(rewritten.attachments[0].metadata, coverageBody.attachments[0].metadata);
    assert.deepStrictEqual(rewritten.model, coverageBody.model);
    assert.deepStrictEqual(rewritten.metadata, coverageBody.metadata);
  }
  await coverageExt.page.fetch(url, { method: 'POST', body: new URLSearchParams({
    message_content: coverageBody.message_content,
    file_name: coverageBody.file_name,
    state: JSON.stringify(coverageBody)
  }) });
  const coverageForm = coverageExt.requests.at(-1).init.body;
  assert(coverageForm.get('message_content').includes('__PII_EMAIL_'));
  assert(coverageForm.get('file_name').includes('__PII_EMAIL_'));
  assert(JSON.parse(coverageForm.get('state')).attachments[0].name.includes('__PII_EMAIL_'));
  const mapRace = extension({}, { aliasMap: { saved: 'original' } });
  const tabA = (await mapRace.sendWorker({ type: 'privy-map-get' })).privyMap;
  const tabB = (await mapRace.sendWorker({ type: 'privy-map-get' })).privyMap;
  tabA.first = 'tab A';
  tabB.second = 'tab B';
  await mapRace.sendWorker({ type: 'privy-map-set', privyMap: tabA });
  await mapRace.sendWorker({ type: 'privy-map-set', privyMap: tabB });
  assert.deepStrictEqual(mapRace.sessionStore.aliasMap, { saved: 'original', first: 'tab A', second: 'tab B' }, 'Stale tab snapshots must merge instead of replacing existing entries');
  await Promise.all([
    mapRace.sendWorker({ type: 'privy-map-set', privyMap: { third: 'tab A' } }),
    mapRace.sendWorker({ type: 'privy-map-set', privyMap: { fourth: 'tab B' } })
  ]);
  assert.deepStrictEqual(mapRace.sessionStore.aliasMap, { saved: 'original', first: 'tab A', second: 'tab B', third: 'tab A', fourth: 'tab B' }, 'Simultaneous background handlers must serialize their read/merge/write operations');
  await mapRace.sendWorker({ type: 'privy-map-set', privyMap: { saved: 'updated' } });
  assert.strictEqual(mapRace.sessionStore.aliasMap.saved, 'updated', 'Incoming values must win on key conflicts');
  const cappedMap = extension();
  const fullMap = Object.fromEntries(Array.from({ length: 20000 }, (_, i) => [`entry-${i}`, `value-${i}`]));
  assert.strictEqual((await cappedMap.sendWorker({ type: 'privy-map-set', privyMap: fullMap })).ok, true, 'A map at the capacity cap must be accepted');
  const storedAtCap = cappedMap.sessionStore.aliasMap;
  const capacityError = 'AliasChat placeholder map is full (20001 entries). Restart the browser to clear it (the map lives in session storage).';
  const overCapacity = await cappedMap.sendWorker({ type: 'privy-map-set', privyMap: { extra: 'overflow', 'entry-0': 'must not overwrite' } });
  assert.strictEqual(overCapacity.error, capacityError);
  assert.strictEqual(cappedMap.sessionStore.aliasMap, storedAtCap, 'An oversized map must not be written to storage');
  assert.deepStrictEqual(cappedMap.sessionStore.aliasMap, fullMap, 'Rejected writes must preserve every stored entry and value');
  await assert.rejects(cappedMap.page.fetch(url, { method: 'POST', body: JSON.stringify({ prompt: 'contact capacity@example.com' }) }), error => error.message === capacityError && error.code === 'map-storage-error');
  assert.strictEqual(cappedMap.requests.length, 0, 'The bridge must block the send when storing placeholders fails');
  assert(cappedMap.messages.some(message => message.type === 'mask-result' && message.error === capacityError && !message.result), 'The bridge must propagate the capacity error without returning a masked body');
  assert(cappedMap.toasts.some(text => text.includes(capacityError)), 'The blocked send must show the capacity error to the user');
  assert.strictEqual(cappedMap.sessionStore.aliasMap, storedAtCap);
  assert.strictEqual((await cappedMap.sendWorker({ type: 'privy-map-set', privyMap: { 'entry-0': 'replacement' } })).ok, true, 'Updating an existing entry at capacity must still succeed');
  assert.strictEqual(cappedMap.sessionStore.aliasMap['entry-0'], 'replacement');
  const updateProbe = extension();
  await updateProbe.page.fetch(url, { method: 'POST', body: JSON.stringify({ prompt: 'contact first@example.com' }) });
  delete updateProbe.sessionStore.aliasMap;
  updateProbe.sessionStore.privyMap = { __PII_EMAIL_abcdef__: 'saved@example.com' };
  const installedKey = [...updateProbe.sessionStore.privyKey];
  await updateProbe.installed({ reason: 'update' });
  assert.deepStrictEqual(updateProbe.sessionStore.privyMap, { __PII_EMAIL_abcdef__: 'saved@example.com' }, 'An update must keep the legacy placeholder map available for migration');
  await updateProbe.page.fetch(url, { method: 'POST', body: JSON.stringify({ prompt: 'contact first@example.com' }) });
  assert.strictEqual(updateProbe.sessionStore.aliasMap.__PII_EMAIL_abcdef__, 'saved@example.com', 'Legacy placeholder maps must migrate to the AliasChat storage key');
  assert.strictEqual(updateProbe.sessionStore.privyKey.length, 32, 'An update must save the replacement key to session storage');
  assert.notDeepStrictEqual(updateProbe.sessionStore.privyKey, installedKey, 'An update must rotate the masking key');
  const retryWorker = extension({}, {}, false, true);
  await assert.rejects(retryWorker.page.fetch(url, { method: 'POST', body: JSON.stringify({ prompt: 'contact retry@example.com' }) }));
  await retryWorker.page.fetch(url, { method: 'POST', body: JSON.stringify({ prompt: 'contact retry@example.com' }) });
  const invalidKey = extension({}, { privyKey: [1, 2, 3] });
  await invalidKey.page.fetch(url, { method: 'POST', body: JSON.stringify({ prompt: 'contact invalid@example.com' }) });
  assert.strictEqual(invalidKey.sessionStore.privyKey.length, 32, 'Invalid stored masking keys must be replaced');
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
  assert(ext.importedExtractable.length && ext.importedExtractable.every(value => value === false), 'HMAC keys must always be imported as non-extractable');
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
  ext.sessionStore.aliasMap.__PII_EMAIL_abcdef__ = 'legacy@example.com';
  ext.sessionStore.aliasMap.__PII_EMAIL_abcdef123456__ = 'old@example.com';
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
  ext.advanceTime(10000);
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
  assert(ext.toasts.includes('🛡 AliasChat: could not mask personal data; request blocked'));
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
  const opaqueToast = '🛡 AliasChat: PDF/image uploads are blocked because they cannot be masked in the browser. You can allow them in AliasChat options (allowOpaqueUploads).';
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
  const unknownUpload = extension();
  for (const name of ['private.eml', 'private.zip']) {
    const unknown = new File(['jane.doe@example.com'], name);
    await assert.rejects(unknownUpload.page.fetch(url, { method: 'POST', body: unknown }), error => error.code === 'unknown-blocked');
    const allowedUnknown = extension({ allowUnknownUploads: true });
    await allowedUnknown.page.fetch(url, { method: 'POST', body: unknown });
    assert.strictEqual(await allowedUnknown.requests[0].init.body.text(), await unknown.text());
    assert(allowedUnknown.toasts.some(text => text.includes('uploaded uninspected')));
  }
  assert.strictEqual(unknownUpload.requests.length, 0);
  assert(unknownUpload.toasts.every(text => text.includes('allowUnknownUploads')));
  const namedUpload = new FormData();
  namedUpload.append('file', new File(['%PDF-1.7'], 'John_Smith_passport.pdf'));
  await allowedUpload.page.fetch(url, { method: 'POST', body: namedUpload });
  const maskedName = allowedUpload.requests.at(-1).init.body.get('file').name;
  assert.strictEqual(maskedName, 'John_Smith_passport.pdf');
  const directForm = await require('./extension/files.js').maskFormData(namedUpload, pii.mask, {}, () => {}, { allowOpaqueUploads: true });
  assert.strictEqual(directForm.get('file').name, 'John_Smith_passport.pdf');
  const metadata = extension();
  const metadataUrl = 'https://chatgpt.com/backend-api/files';
  const metadataBody = JSON.stringify({ file_name: 'John_Smith_passport.pdf', file_size: 8, use_case: 'multimodal' });
  await metadata.page.fetch(metadataUrl, { method: 'POST', body: metadataBody });
  const maskedMetadata = JSON.parse(metadata.requests.at(-1).init.body);
  assert.strictEqual(maskedMetadata.file_name, 'John_Smith_passport.pdf');
  assert.strictEqual(maskedMetadata.file_size, 8);
  assert.strictEqual(maskedMetadata.use_case, 'multimodal');
  await metadata.page.fetch(new Request(metadataUrl, { method: 'POST', body: metadataBody }));
  assert.strictEqual(JSON.parse(await metadata.requests.at(-1).input.text()).file_name, maskedMetadata.file_name);
  const metadataXhr = new metadata.page.XMLHttpRequest();
  metadataXhr.open('POST', metadataUrl);
  const metadataSent = new Promise((resolve, reject) => {
    metadataXhr.addEventListener('load', resolve);
    metadataXhr.addEventListener('error', reject);
  });
  metadataXhr.send(metadataBody);
  await metadataSent;
  assert.strictEqual(JSON.parse(metadata.requests.at(-1).body).file_name, maskedMetadata.file_name);
  const storageBytes = new Uint8Array([0xff, 0xfe, 0x80, 0x00]);
  await metadata.page.fetch('https://storage.example/files/upload', { method: 'PUT', body: storageBytes });
  assert.strictEqual(metadata.requests.at(-1).init.body, storageBytes);
  const zip = require('./core/zip.js');
  const office = require('./core/office.js');
  const encoder = new TextEncoder();
  const coreXml = '<cp:coreProperties xmlns:dc="creator@example.com"><dc:creator>Jane Doe</dc:creator><cp:lastModifiedBy>John Smith</cp:lastModifiedBy><dc:title>jane@example.com &amp; report</dc:title></cp:coreProperties>';
  const appXml = '<Properties><Company>jane@example.com</Company></Properties>';
  const officeBytes = await zip.write([
    { name: 'docProps/core.xml', data: encoder.encode(coreXml) },
    { name: 'docProps/app.xml', data: encoder.encode(appXml) },
    { name: 'word/document.xml', data: encoder.encode('<w:t>unchanged text</w:t>') }
  ]);
  const maskedOffice = await zip.read(await office.mask(officeBytes, pii.mask, {}));
  const coreText = new TextDecoder().decode(maskedOffice.find(entry => entry.name === 'docProps/core.xml').data);
  assert(!coreText.includes('Jane Doe') && !coreText.includes('John Smith'));
  assert(coreText.includes('<dc:creator>__PII_NAME_') && coreText.includes('<cp:lastModifiedBy>__PII_NAME_'));
  assert(coreText.includes('xmlns:dc="creator@example.com"') && coreText.includes('&amp; report'));
  assert(new TextDecoder().decode(maskedOffice.find(entry => entry.name === 'docProps/app.xml').data).includes('<Company>__PII_EMAIL_'));
  for (const littleEndian of [true, false]) {
    const text = 'Contact jane.doe@example.com';
    const bytes = new Uint8Array(2 + text.length * 2);
    bytes.set(littleEndian ? [0xff, 0xfe] : [0xfe, 0xff]);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < text.length; i++) view.setUint16(2 + i * 2, text.charCodeAt(i), littleEndian);
    await ext.page.fetch(url, { method: 'POST', body: new File([bytes], 'unicode.txt') });
    const maskedBytes = new Uint8Array(await ext.requests.at(-1).init.body.arrayBuffer());
    assert.deepStrictEqual([...maskedBytes.slice(0, 2)], [...bytes.slice(0, 2)]);
    const decoded = new TextDecoder(littleEndian ? 'utf-16le' : 'utf-16be', { fatal: true }).decode(maskedBytes);
    assert(decoded.includes('__PII_EMAIL_') && !decoded.includes('jane.doe@example.com'));
  }
  for (const bytes of [new Uint8Array([0xd5, 0xc5, 0xc8, 0xfd, 0x2c, ...encoder.encode('13800138000')]), new Uint8Array([0x61, 0, 0x62, 0]), new Uint8Array([0xff, 0xfe, 0x61])]) {
    const invalidEncoding = extension();
    await assert.rejects(invalidEncoding.page.fetch(url, { method: 'POST', body: new File([bytes], 'legacy.csv') }), error => error.code === 'encoding-blocked');
    assert.strictEqual(invalidEncoding.requests.length, 0);
    assert(invalidEncoding.toasts.some(text => text.includes('encoding could not be decoded safely')));
    const allowedEncoding = extension({ allowUnknownUploads: true });
    await allowedEncoding.page.fetch(url, { method: 'POST', body: new File([bytes], 'legacy.csv') });
    assert.deepStrictEqual(new Uint8Array(await allowedEncoding.requests[0].init.body.arrayBuffer()), bytes);
    assert(allowedEncoding.toasts.some(text => text.includes('text encoding could not be decoded safely')));
  }
  const utf8Bom = new Uint8Array([0xef, 0xbb, 0xbf, ...encoder.encode('jane.doe@example.com')]);
  await ext.page.fetch(url, { method: 'POST', body: new File([utf8Bom], 'bom.txt') });
  const maskedUtf8 = new Uint8Array(await ext.requests.at(-1).init.body.arrayBuffer());
  assert.deepStrictEqual([...maskedUtf8.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  assert(new TextDecoder().decode(maskedUtf8).includes('__PII_EMAIL_'));
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

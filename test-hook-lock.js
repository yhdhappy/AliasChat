const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aliaschat-hook-lock-'));
const script = path.join(__dirname, 'hooks/mask.js');
const prompt = { hook_event_name: 'UserPromptSubmit', session_id: 'lock-test', prompt: 'email private@example.com' };
const start = (dir, input = prompt, preload) => {
  const outputFile = path.join(root, crypto.randomBytes(8).toString('hex') + '.out');
  const outputFd = fs.openSync(outputFile, 'wx');
  const child = spawn(process.execPath, [...(preload ? ['--require', preload] : []), script], {
    env: { ...process.env, CLAUDE_PLUGIN_DATA: dir }, stdio: ['pipe', outputFd, 'pipe'], timeout: 12000
  });
  fs.closeSync(outputFd);
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => {
      try {
        assert.strictEqual(code, 0, stderr);
        assert.strictEqual(stderr, '');
        const stdout = fs.readFileSync(outputFile, 'utf8');
        assert(stdout, `No hook output: ${dir} preload=${preload}`);
        resolve(JSON.parse(stdout));
      } catch (error) { reject(error); }
    });
  });
  child.stdin.end(JSON.stringify(input));
  return { child, done };
};
const succeeds = output => {
  assert.strictEqual(output.decision, 'block');
  assert(!output.reason.includes('AliasChat error'), output.reason);
  assert(!output.reason.includes('private@example.com'));
};
const lock = (dir, timestamp, pid) => {
  fs.mkdirSync(path.join(dir, 'placeholder-key.lock'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'placeholder-key.lock', 'owner.json'), JSON.stringify({ timestamp, pid }));
};

const source = fs.readFileSync(script, 'utf8');
const hookRequire = require('module').createRequire(script);
const harness = (dir, options = {}) => {
  let input;
  let output;
  const context = {
    require: name => name === 'fs' ? { ...fs, ...options.fs, readFileSync: (file, ...args) => file === 0
      ? JSON.stringify(input) : (options.fs?.readFileSync || fs.readFileSync)(file, ...args) }
      : name === 'child_process' ? { spawnSync, execFileSync: options.exec || (() => { throw new Error('Unexpected vision call'); }) }
        : name === 'os' && options.home ? { ...os, homedir: () => options.home } : hookRequire(name),
    module: {}, __dirname: path.dirname(script),
    process: { platform: options.platform || 'darwin', pid: process.pid, kill: process.kill,
      env: options.home ? {} : { CLAUDE_PLUGIN_DATA: dir }, stdout: { write: text => { output = JSON.parse(text); } } }
  };
  require('vm').runInNewContext(source + '\nglobalThis.hook = { main, visionBinary };', context, { timeout: 1000 });
  return {
    binary: context.hook.visionBinary,
    run: value => { input = value; output = null; context.hook.main(); return output; }
  };
};
const readInput = file => ({ hook_event_name: 'PreToolUse', session_id: 'vision-test', tool_name: 'Read',
  cwd: root, tool_input: { file_path: file } });
const denied = (output, text) => {
  assert(output, 'Read must receive a blocking decision');
  assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
  assert.strictEqual(output.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert(output.hookSpecificOutput.permissionDecisionReason.includes(text));
  assert(!output.hookSpecificOutput.updatedInput);
  assert(!output.hookSpecificOutput.permissionDecisionReason.includes('\n    at '));
};
const readyVision = dir => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'vision'), 'mock');
  const future = new Date(Date.now() + 10000);
  fs.utimesSync(path.join(dir, 'vision'), future, future);
};
const visionRegressions = () => {
  const dir = path.join(root, 'vision-errors');
  readyVision(dir);
  const ocr = JSON.stringify([{ text: 'private@example.com', words: [], box: [0, 0, 1, 1] }]);
  for (const mode of ['pdf-text', 'ocr', 'redact']) {
    const file = path.join(root, mode === 'pdf-text' ? 'corrupt.pdf' : 'corrupt.png');
    const hook = harness(dir, { exec: (command, args) => {
      if (args[0] === mode) throw new Error(`${mode} failed`);
      assert.strictEqual(args[0], 'ocr');
      return ocr;
    } });
    const output = hook.run(readInput(file));
    denied(output, `${mode} failed`);
    assert(output.hookSpecificOutput.permissionDecisionReason.includes(file));
  }
  console.log('hook vision extraction, OCR and redaction failures block ok (mock)');

  const unavailable = path.join(root, 'vision-unavailable');
  const noVision = harness(unavailable, { platform: 'linux' });
  for (const extension of ['pdf', 'png']) denied(noVision.run(readInput(path.join(root, `uninspected.${extension}`))), 'Swift toolchain');
  const marker = path.join(unavailable, 'vision-failure.json');
  const recorded = fs.readFileSync(marker, 'utf8');
  assert(Number.isFinite(JSON.parse(recorded).timestamp));
  assert.strictEqual(noVision.binary(), null);
  assert.strictEqual(fs.readFileSync(marker, 'utf8'), recorded);
  console.log('hook unavailable vision blocks PDF and image reads ok');
  const recovery = noVision.run(readInput(path.join(root, 'uninspected.png'))).hookSpecificOutput.permissionDecisionReason;
  assert(recovery.includes(marker));
  assert(recovery.includes('xcode-select --install'));
  assert(recovery.includes('resend the prompt or retry the Read'));
  const unsupportedScratch = path.join(root, 'unsupported-scratch');
  fs.mkdirSync(path.join(unsupportedScratch, 'images'), { recursive: true });
  fs.writeFileSync(path.join(unsupportedScratch, 'images', 'paste.png'), 'mock');
  const unsupportedInput = { hook_event_name: 'UserPromptSubmit', session_id: 'unsupported', prompt: 'Inspect', scratchpad_dir: unsupportedScratch };
  for (let i = 0; i < 2; i++) {
    const output = noVision.run(unsupportedInput);
    assert.strictEqual(output.decision, 'block');
    assert.strictEqual(output.suppressOriginalPrompt, true);
    assert(output.reason.includes('blocked pasted image paste.png'));
    assert(output.reason.includes('macOS'));
  }
  assert(!fs.existsSync(path.join(unavailable, 'unsupported.images')));
  const hooks = JSON.parse(fs.readFileSync(path.join(__dirname, 'hooks/hooks.json'), 'utf8')).hooks;
  for (const event of ['UserPromptSubmit', 'PreToolUse']) assert(hooks[event][0].hooks[0].timeout > 120);


  const cached = path.join(root, 'vision-cached');
  let attempts = 0;
  const compiler = (command, args, options) => {
    assert.strictEqual(command, 'swiftc');
    assert.strictEqual(options.timeout, 120000);
    attempts++;
    throw new Error('Compiler timed out');
  };
  assert.strictEqual(harness(cached, { exec: compiler }).binary(), null);
  assert.strictEqual(attempts, 1);
  const failureFile = path.join(cached, 'vision-failure.json');
  const timestamp = JSON.parse(fs.readFileSync(failureFile)).timestamp;
  assert.strictEqual(harness(cached, { exec: compiler }).binary(), null);
  assert.strictEqual(attempts, 1);
  assert.strictEqual(JSON.parse(fs.readFileSync(failureFile)).timestamp, timestamp);
  fs.rmSync(failureFile);
  assert.strictEqual(harness(cached, { exec: compiler }).binary(), null);
  assert.strictEqual(attempts, 2);
  fs.writeFileSync(failureFile, JSON.stringify({ timestamp: Date.now() - 5 * 60 * 1000 - 1 }));
  assert.strictEqual(harness(cached, { exec: compiler }).binary(), null);
  assert.strictEqual(attempts, 3);
  fs.writeFileSync(failureFile, JSON.stringify({ timestamp: Date.now() - 5 * 60 * 1000 - 1 }));
  const successful = harness(cached, { exec: (command, args) => {
    attempts++;
    readyVision(cached);
  } });
  assert.strictEqual(successful.binary(), path.join(cached, 'vision'));
  assert.strictEqual(attempts, 4);
  assert(!fs.existsSync(failureFile));
  fs.writeFileSync(failureFile, JSON.stringify({ timestamp: Date.now() }));
  assert.strictEqual(harness(cached).binary(), path.join(cached, 'vision'));
  console.log('hook compiler failure cached across invocations for five minutes and success reused ok (mock)');

  fs.writeFileSync(failureFile, JSON.stringify({ timestamp: Date.now() }));
  assert.strictEqual(harness(cached).binary(), path.join(cached, 'vision'));
  const old = new Date(0);
  fs.utimesSync(path.join(cached, 'vision'), old, old);
  let rebuilt = false;
  const stale = harness(cached, { exec: () => { rebuilt = true; readyVision(cached); } });
  assert.strictEqual(stale.binary(), path.join(cached, 'vision'));
  assert(rebuilt, 'An existing outdated binary must bypass the failure cache and rebuild');

  const traversal = path.join(dir, 'reads', 'vision-test') + '/../../outside.pdf';
  const containment = harness(dir);
  denied(containment.run(readInput(traversal)), 'Unexpected vision call');
  denied(containment.run(readInput(path.join(dir, 'reads', 'vision-test-other', 'outside.pdf'))), 'Unexpected vision call');
  assert.strictEqual(containment.run(readInput(path.join(dir, 'reads', 'vision-test', 'safe.pdf'))), null);
  const crash = harness(dir, { fs: { existsSync: () => { throw new Error('Filesystem unavailable'); } } });
  denied(crash.run(readInput('/tmp/test.pdf')), 'Filesystem unavailable');
  console.log('hook traversal and sibling prefixes rejected; PreToolUse catch blocks ok');

  for (const mode of ['ocr', 'redact']) {
    const pastedDir = path.join(root, `pasted-${mode}`);
    const scratch = path.join(root, `scratch-${mode}`);
    readyVision(pastedDir);
    fs.mkdirSync(path.join(scratch, 'images'), { recursive: true });
    const image = path.join(scratch, 'images', 'paste.png');
    fs.writeFileSync(image, 'mock');
    let failed = false;
    let scans = 0;
    const hook = harness(pastedDir, { exec: (command, args) => {
      if (args[0] === 'ocr') scans++;
      if (args[0] === mode && !failed) { failed = true; throw new Error(`${mode} interrupted`); }
      if (args[0] === 'ocr') return args[1].includes('-redacted.') ? '[]' : ocr;
      fs.writeFileSync(args[2], 'redacted');
      return '';
    } });
    const input = { hook_event_name: 'UserPromptSubmit', session_id: 'pasted', prompt: 'Inspect this', scratchpad_dir: scratch };
    const failure = hook.run(input);
    assert.strictEqual(failure.decision, 'block');
    assert(failure.reason.includes(`${mode} interrupted`));
    const seen = path.join(pastedDir, 'pasted.images');
    assert(!fs.existsSync(seen));
    const retry = hook.run(input);
    assert.strictEqual(retry.decision, 'block');
    assert(retry.reason.includes('personal data found in a pasted image'));
    assert.strictEqual(scans, 2);
    assert(!fs.existsSync(seen));
    assert.strictEqual(hook.run(input).decision, 'block');
    assert.strictEqual(scans, 4);
    assert(!fs.readFileSync(seen, 'utf8').includes(image + '\n'));
    fs.rmSync(image);
    assert.strictEqual(hook.run(input), null);
    assert.strictEqual(scans, 4);
    const cleanImage = path.join(scratch, 'images', 'clean.png');
    fs.writeFileSync(cleanImage, 'mock');
    let cleanScans = 0;
    const clean = harness(pastedDir, { exec: () => { cleanScans++; return '[]'; } });
    assert.strictEqual(clean.run(input), null);
    assert(fs.readFileSync(seen, 'utf8').includes(cleanImage + '\n'));
    assert.strictEqual(clean.run(input), null);
    assert.strictEqual(cleanScans, 1);
  }
  console.log('hook pasted image OCR/redaction retry and successful seen marking ok (mock)');

  const home = path.join(root, 'legacy-home');
  const legacy = path.join(home, '.claude', 'privyAI');
  const current = path.join(home, '.claude', 'aliaschat');
  fs.mkdirSync(legacy, { recursive: true });
  const key = crypto.randomBytes(32);
  fs.writeFileSync(path.join(legacy, 'placeholder.key'), key);
  let renamed = false;
  const legacyHook = harness(current, { home, fs: {
    writeFileSync: (file, content, options) => {
      if (file.endsWith('.tmp')) {
        assert(!fs.existsSync(path.join(current, 'placeholder.key')));
        assert.strictEqual(path.dirname(file), current);
        assert.strictEqual(options.mode, 0o600);
        assert.strictEqual(options.flag, 'wx');
        assert.deepStrictEqual(content, key);
      }
      return fs.writeFileSync(file, content, options);
    },
    renameSync: (from, to) => {
      assert(!fs.existsSync(to));
      assert.deepStrictEqual(fs.readFileSync(from), key);
      fs.renameSync(from, to);
      renamed = true;
    }
  } });
  succeeds(legacyHook.run(prompt));
  assert(renamed);
  assert.deepStrictEqual(fs.readFileSync(path.join(current, 'placeholder.key')), key);
  assert.strictEqual(fs.statSync(path.join(current, 'placeholder.key')).mode & 0o777, 0o600);
  assert(!fs.readdirSync(current).some(name => name.endsWith('.tmp')));
  console.log('hook legacy key atomically published with private permissions ok');
};

(async () => {
  visionRegressions();
  const dir = path.join(root, 'concurrent');
  const marker = path.join(root, 'writing');
  const preload = path.join(root, 'delay.cjs');
  fs.writeFileSync(preload, `const fs = require('fs');
const original = fs.renameSync;
fs.renameSync = (...args) => {
  fs.writeFileSync(${JSON.stringify(marker)}, 'ready');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  return original(...args);
};
`);
  const first = start(dir, prompt, preload);
  const deadline = Date.now() + 3000;
  while (!fs.existsSync(marker)) {
    assert(Date.now() < deadline, 'First process did not reach publication');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  const owner = JSON.parse(fs.readFileSync(path.join(dir, 'placeholder-key.lock', 'owner.json')));
  assert.strictEqual(owner.pid, first.child.pid);
  assert(Date.now() - owner.timestamp < 3000);
  const second = start(dir);
  const outputs = await Promise.all([first.done, second.done]);
  outputs.forEach(succeeds);
  const key = fs.readFileSync(path.join(dir, 'placeholder.key'));
  assert.strictEqual(key.length, 32);
  const digest = crypto.createHmac('sha256', key).update('private@example.com').digest('hex').slice(0, 12);
  outputs.forEach(output => assert(output.reason.includes(digest)));
  assert(!fs.existsSync(path.join(dir, 'placeholder-key.lock')));
  console.log('hook concurrent initialization ok');

  lock(dir, Date.now(), process.pid);
  succeeds(await start(dir).done);
  assert.deepStrictEqual(fs.readFileSync(path.join(dir, 'placeholder.key')), key);
  assert(fs.existsSync(path.join(dir, 'placeholder-key.lock')));
  console.log('hook existing key bypass ok');

  const stale = path.join(root, 'stale');
  lock(stale, Date.now() - 61000, process.pid);
  succeeds(await start(stale).done);
  assert(!fs.existsSync(path.join(stale, 'placeholder-key.lock')));
  console.log('hook old lock recovery ok');

  const dead = path.join(root, 'dead');
  lock(dead, Date.now(), first.child.pid);
  succeeds(await start(dead).done);
  assert(!fs.existsSync(path.join(dead, 'placeholder-key.lock')));
  console.log('hook dead PID recovery ok');

  const active = path.join(root, 'active');
  lock(active, Date.now(), process.pid);
  const before = Date.now();
  const timeout = await start(active).done;
  assert(timeout.reason.includes('timed out after 5 seconds'));
  assert(Date.now() - before >= 4900 && Date.now() - before < 7000);
  assert(!fs.existsSync(path.join(active, 'placeholder.key')));
  console.log('hook live lock 5-second timeout ok');

  fs.writeFileSync(path.join(dir, 'placeholder.key'), 'invalid');
  for (const tool_name of ['Bash', 'mcp__test__read']) {
    const failure = await start(dir, { hook_event_name: 'PostToolUse', session_id: 'lock-test', tool_name,
      tool_response: { stdout: 'private@example.com', stderr: 'sensitive details', interrupted: false, isImage: false } }).done;
    assert.strictEqual(failure.continue, false);
    assert.strictEqual(failure.decision, 'block');
    assert(failure.stopReason.includes('NOT masked'));
    assert(failure.systemMessage.includes('SECURITY FAILURE'));
    assert.deepStrictEqual(failure.hookSpecificOutput.updatedToolOutput, { stdout: '', stderr: '', interrupted: false, isImage: false });
    assert(!JSON.stringify(failure).includes('private@example.com'));
  }
  console.log('hook PostToolUse failure intervention ok');

  let compiled = false;
  const source = fs.readFileSync(script, 'utf8');
  const hookRequire = require('module').createRequire(script);
  const hookModule = {};
  const isolatedRequire = name => name === 'fs' ? { ...fs, readFileSync: (file, ...args) => file === 0
    ? JSON.stringify({ session_id: 'vision-test', hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/tmp/test.pdf' } })
    : fs.readFileSync(file, ...args) } : name === 'child_process' ? {
      spawnSync,
      execFileSync: (command, args, options) => {
        assert.strictEqual(command, 'swiftc');
        assert.strictEqual(options.timeout, 120000);
        compiled = true;
        throw Object.assign(new Error('Compiler timed out'), { code: 'ETIMEDOUT' });
      }
    } : hookRequire(name);
  isolatedRequire.main = hookModule;
  require('vm').runInNewContext(source, { require: isolatedRequire, module: hookModule, __dirname: path.dirname(script),
    process: { platform: 'darwin', env: { CLAUDE_PLUGIN_DATA: path.join(root, 'vision') }, stdout: { write: () => {} } }
  }, { timeout: 1000 });
  assert(compiled);
  console.log('hook Swift compiler timeout option ok (mock)');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

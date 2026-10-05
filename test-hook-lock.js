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

(async () => {
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

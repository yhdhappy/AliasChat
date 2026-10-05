#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { mask: maskValue, createTokenizer, unmask, hasPlaceholder, deepMap, configure } = require('../core/pii.js');
const { execFileSync } = require('child_process');
const crypto = require('crypto');

const customDir = process.env.CLAUDE_PLUGIN_DATA;
const dir = customDir || path.join(os.homedir(), '.claude', 'aliaschat');
const legacyDir = customDir ? null : path.join(os.homedir(), '.claude', 'privyAI');
const dataDirs = legacyDir ? [dir, legacyDir] : [dir];
const ensureDir = target => {
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  fs.chmodSync(target, 0o700);
};
let tokenize;
const mask = (text, found) => {
  if (!tokenize) {
    ensureDir(dir);
    const keyFile = path.join(dir, 'placeholder.key');
    const lockDir = path.join(dir, 'placeholder-key.lock');
    if (!fs.existsSync(keyFile)) {
      const deadline = Date.now() + 5000;
      const sleeper = new Int32Array(new SharedArrayBuffer(4));
      let locked = false;
      while (!fs.existsSync(keyFile)) {
        try {
          fs.mkdirSync(lockDir, { mode: 0o700 });
          locked = true;
          break;
        } catch (error) {
          if (error.code !== 'EEXIST') throw error;
        }
        try {
          const stat = fs.statSync(lockDir);
          let timestamp = stat.mtimeMs;
          let dead = false;
          try {
            const owner = JSON.parse(fs.readFileSync(path.join(lockDir, 'owner.json'), 'utf8'));
            if (Number.isFinite(owner.timestamp)) timestamp = owner.timestamp;
            if (Number.isInteger(owner.pid) && owner.pid > 0) {
              try { process.kill(owner.pid, 0); } catch (error) { if (error.code === 'ESRCH') dead = true; }
            }
          } catch (error) {
            if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
          }
          if (Date.now() - timestamp > 60000 || dead) {
            const current = fs.statSync(lockDir);
            if (current.ino === stat.ino && current.mtimeMs === stat.mtimeMs) fs.rmSync(lockDir, { recursive: true, force: true });
          }
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
        if (Date.now() >= deadline) throw new Error('Placeholder key initialization is locked; timed out after 5 seconds');
        Atomics.wait(sleeper, 0, 0, Math.min(100, deadline - Date.now()));
      }
      if (locked) try {
        fs.writeFileSync(path.join(lockDir, 'owner.json'), JSON.stringify({ timestamp: Date.now(), pid: process.pid }), { mode: 0o600, flag: 'wx' });
        if (!fs.existsSync(keyFile)) {
          for (const name of fs.readdirSync(dir)) if (/^placeholder-.*\.tmp$/.test(name)) fs.rmSync(path.join(dir, name), { force: true });
          if (legacyDir && fs.existsSync(path.join(legacyDir, 'placeholder.key'))) {
            const temporary = path.join(dir, `placeholder-${crypto.randomBytes(16).toString('hex')}.tmp`);
            try {
              fs.writeFileSync(temporary, fs.readFileSync(path.join(legacyDir, 'placeholder.key')), { mode: 0o600, flag: 'wx' });
              fs.renameSync(temporary, keyFile);
            } finally {
              fs.rmSync(temporary, { force: true });
            }
          }
          if (!fs.existsSync(keyFile)) {
            const temporary = path.join(dir, `placeholder-${crypto.randomBytes(16).toString('hex')}.tmp`);
            try {
              fs.writeFileSync(temporary, crypto.randomBytes(32), { mode: 0o600, flag: 'wx' });
              fs.renameSync(temporary, keyFile);
            } finally {
              fs.rmSync(temporary, { force: true });
            }
          }
        }
      } finally {
        fs.rmSync(lockDir, { recursive: true, force: true });
      }
    }
    const key = fs.readFileSync(keyFile);
    if (key.length !== 32) throw new Error('Invalid placeholder key');
    tokenize = createTokenizer(key);
  }
  return maskValue(text, found, tokenize);
};
const file = id => path.join(dir, `${id}.jsonl`);
const files = id => dataDirs.map(root => path.join(root, `${id}.jsonl`));
const save = (id, found) => {
  const lines = Object.entries(found).map(([p, v]) => JSON.stringify({ p, v }) + '\n').join('');
  if (!lines) return;
  ensureDir(dir);
  fs.appendFileSync(file(id), lines, { mode: 0o600 });
};
const prune = () => {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  for (const root of dataDirs) try {
    for (const f of fs.readdirSync(root)) if (f.endsWith('.jsonl') && fs.statSync(path.join(root, f)).mtimeMs < cutoff) fs.rmSync(path.join(root, f), { force: true });
  } catch {}
};
const load = id => {
  const map = {};
  for (const target of files(id).reverse()) try {
    for (const line of fs.readFileSync(target, 'utf8').split('\n')) {
      if (!line) continue;
      const { p, v } = JSON.parse(line);
      map[p] = v;
    }
  } catch {}
  return map;
};

const visionBinary = () => {
  const src = path.join(__dirname, 'vision.swift');
  const bin = path.join(dir, 'vision');
  const failure = path.join(dir, 'vision-failure.json');
  const binaryExists = process.platform === 'darwin' && fs.existsSync(bin);
  try {
    if (binaryExists && fs.statSync(bin).mtimeMs >= fs.statSync(src).mtimeMs) return bin;
    try {
      const { timestamp } = JSON.parse(fs.readFileSync(failure, 'utf8'));
      if (!binaryExists && Number.isFinite(timestamp) && Date.now() - timestamp < 5 * 60 * 1000) return null;
    } catch {}
    ensureDir(dir);
    if (process.platform !== 'darwin') {
      fs.writeFileSync(failure, JSON.stringify({ timestamp: Date.now() }), { mode: 0o600 });
      return null;
    }
    execFileSync('swiftc', ['-O', '-o', bin, src], { stdio: 'ignore', timeout: 120000 });
    fs.rmSync(failure, { force: true });
    return bin;
  } catch {
    ensureDir(dir);
    fs.writeFileSync(failure, JSON.stringify({ timestamp: Date.now() }), { mode: 0o600 });
    return null;
  }
};
const visionUnavailable = () => `Inspection requires macOS with an available Swift toolchain. On macOS, run xcode-select --install and finish installing Xcode Command Line Tools, then delete ${path.join(dir, 'vision-failure.json')} and resend the prompt or retry the Read. Failed compilation is cached for five minutes; on other platforms use a text version of the file instead.`;
const vision = (...args) => execFileSync(visionBinary(), args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const IMAGE = /\.(png|jpe?g|gif|webp|bmp|tiff?|heic)$/i;
const readsDir = (id, root = dir) => path.join(root, 'reads', id);
const readDirs = id => dataDirs.map(root => readsDir(id, root));
const stem = file => `${path.basename(file)}-${crypto.createHash('sha1').update(file).digest('hex').slice(0, 8)}`;

const blockRead = reason => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });
const failureMessage = error => error && error.message ? error.message : String(error);

const redirectPdf = (id, input, found) => {
  const file = input.tool_input.file_path;
  if (!visionBinary()) return blockRead(`AliasChat: blocked Read of ${file}; ${visionUnavailable()}`);
  let text;
  try {
    text = vision('pdf-text', file).replace(/\s+$/, '');
  } catch (error) {
    return blockRead(`AliasChat: blocked Read of ${file}; PDF text extraction failed: ${failureMessage(error)}`);
  }
  const content = text.trim() ? mask(text, found) : 'AliasChat: this PDF has no extractable text, so it was not sent. Ask for it as an image instead.';
  const out = path.join(readsDir(id), `${stem(file)}.txt`);
  ensureDir(readsDir(id));
  fs.writeFileSync(out, content, { mode: 0o600 });
  const n = Object.keys(found).length;
  return {
    systemMessage: text.trim() ? `AliasChat: converted ${path.basename(file)} to text and masked ${n} value${n === 1 ? '' : 's'}` : `AliasChat: ${path.basename(file)} has no extractable text, nothing was sent`,
    hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: { ...input.tool_input, file_path: out } }
  };
};

const imageBoxes = (file, found) => {
  const boxes = [];
  for (const line of JSON.parse(vision('ocr', file))) {
    const hits = {};
    mask(line.text, hits);
    for (const value of Object.values(hits)) {
      let at = line.text.indexOf(value);
      while (at >= 0) {
        const end = at + value.length;
        const words = line.words.filter(w => w.start < end && w.start + w.length > at);
        boxes.push(...(words.length ? words.map(w => w.box) : [line.box]));
        at = line.text.indexOf(value, end);
      }
    }
    Object.assign(found, hits);
  }
  return boxes;
};

const redirectImage = (id, input, found) => {
  const file = input.tool_input.file_path;
  if (!visionBinary()) return blockRead(`AliasChat: blocked Read of ${file}; ${visionUnavailable()}`);
  let boxes;
  try {
    boxes = imageBoxes(file, found);
  } catch (error) {
    return blockRead(`AliasChat: blocked Read of ${file}; image OCR failed: ${failureMessage(error)}`);
  }
  if (!boxes.length) return null;
  const out = path.join(readsDir(id), `${stem(file)}${/\.jpe?g$/i.test(file) ? '.jpg' : '.png'}`);
  ensureDir(readsDir(id));
  try {
    vision('redact', file, out, JSON.stringify(boxes));
  } catch (error) {
    return blockRead(`AliasChat: blocked Read of ${file}; image redaction failed: ${failureMessage(error)}`);
  }
  fs.chmodSync(out, 0o600);
  const n = Object.keys(found).length;
  return {
    systemMessage: `AliasChat: redacted ${n} value${n === 1 ? '' : 's'} in ${path.basename(file)}`,
    hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: { ...input.tool_input, file_path: out } }
  };
};

const loadConfig = cwd => {
  const candidates = [process.env.MASK2AI_CONFIG, cwd && path.join(cwd, '.mask2ai.json'), path.join(os.homedir(), '.mask2ai', 'config.json')].filter(Boolean);
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      configure(JSON.parse(fs.readFileSync(file, 'utf8')));
      return { file };
    } catch (e) {
      return { file, error: e.message };
    }
  }
  return null;
};

const pastedImages = (id, input, found) => {
  const imgDir = input.scratchpad_dir && path.join(input.scratchpad_dir, 'images');
  if (!imgDir || !fs.existsSync(imgDir)) return [];
  const seenFile = path.join(dir, `${id}.images`);
  const seen = new Set(dataDirs.flatMap(root => {
    const file = path.join(root, `${id}.images`);
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n') : [];
  }));
  const blocked = [];
  for (const name of fs.readdirSync(imgDir)) {
    const file = path.join(imgDir, name);
    if (!IMAGE.test(name) || seen.has(file) || Date.now() - fs.statSync(file).mtimeMs > 10 * 60 * 1000) continue;
    if (!visionBinary()) throw new Error(`AliasChat: blocked pasted image ${name}. ${visionUnavailable()}`);
    ensureDir(dir);
    const hits = {};
    const boxes = imageBoxes(file, hits);
    if (!boxes.length) {
      fs.appendFileSync(seenFile, file + '\n', { mode: 0o600 });
      continue;
    }
    const out = path.join(imgDir, name.replace(/\.(\w+)$/, '-redacted.png'));
    vision('redact', file, out, JSON.stringify(boxes));
    Object.assign(found, hits);
    blocked.push({ name, out, count: Object.keys(hits).length });
  }
  return blocked;
};

const main = () => {
  let input;
  const out = o => process.stdout.write(JSON.stringify(o));
  try {
    input = JSON.parse(fs.readFileSync(0, 'utf8'));
    const cfg = loadConfig(input.cwd);
    const id = input.session_id;
    switch (input.hook_event_name) {
      case 'SessionStart':
        out({ systemMessage: 'AliasChat active: personal data in prompts and tool output is masked before it reaches the model' + (cfg ? (cfg.error ? `. Config ${cfg.file} ignored: ${cfg.error}` : `. Config: ${cfg.file}`) : ''), hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'Tokens shaped like __PII_EMAIL_a1b2c3d4e5f6__ are personal data masked by the AliasChat plugin. Treat them as opaque literals: copy them verbatim into tool inputs, never guess, expand or alter them.' } });
        break;
      case 'UserPromptSubmit': {
        const found = {};
        const masked = mask(input.prompt, found);
        const images = pastedImages(id, input, found);
        if (masked === input.prompt && !images.length) break;
        save(id, found);
        if (images.length) {
          const list = images.map(i => `${i.name}: ${i.count} value${i.count === 1 ? '' : 's'} found, redacted copy at ${i.out}`).join('\n');
          out({
            decision: 'block',
            suppressOriginalPrompt: true,
            reason: `AliasChat: personal data found in a pasted image, nothing was sent.\n${list}\n\nAttach the redacted copy instead (drag it into the chat) and resend${masked === input.prompt ? '.' : ' with this masked text:\n\n' + masked}`
          });
          break;
        }
        const copied = process.platform === 'darwin' && spawnSync('pbcopy', { input: masked }).status === 0;
        out({
          decision: 'block',
          suppressOriginalPrompt: true,
          reason: `AliasChat: personal data found in your prompt, nothing was sent. ${copied ? 'A masked copy is in your clipboard: press Edit prompt, select all, paste, send. In the terminal just paste and send' : 'Resend this masked version'}:\n\n${masked}`
        });
        break;
      }
      case 'PostToolUse': {
        const found = {};
        const kind = input.tool_name === 'Read' && input.tool_response && input.tool_response.type;
        if (kind === 'pdf' || kind === 'image') break;
        const updated = deepMap(input.tool_response, s => mask(s, found));
        if (!Object.keys(found).length) break;
        save(id, found);
        const n = Object.keys(found).length;
        out({ systemMessage: `AliasChat: masked ${n} value${n === 1 ? '' : 's'} in ${input.tool_name} output`, hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: updated } });
        break;
      }
      case 'PreToolUse': {
        const file = input.tool_name === 'Read' && input.tool_input && input.tool_input.file_path;
        if (file && (/\.pdf$/i.test(file) || IMAGE.test(file)) && !readDirs(id).some(directory => {
          const relative = path.relative(path.resolve(directory), path.resolve(file));
          return !path.isAbsolute(relative) && !relative.startsWith('..');
        })) {
          const found = {};
          const result = /\.pdf$/i.test(file) ? redirectPdf(id, input, found) : redirectImage(id, input, found);
          save(id, found);
          if (result && result.hookSpecificOutput && result.hookSpecificOutput.updatedInput && input.cwd && path.resolve(file).startsWith(path.resolve(input.cwd) + path.sep)) result.hookSpecificOutput.permissionDecision = 'allow';
          if (result) out(result);
          break;
        }
        if (!hasPlaceholder(JSON.stringify(input.tool_input))) break;
        const map = load(id);
        const restored = deepMap(input.tool_input, s => unmask(s, map));
        const decision = input.permission_mode === 'bypassPermissions' ? { permissionDecision: 'allow' } : {};
        out({ hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: restored, ...decision } });
        break;
      }
      case 'MessageDisplay':
        if (!hasPlaceholder(input.delta)) break;
        out({ hookSpecificOutput: { hookEventName: 'MessageDisplay', displayContent: unmask(input.delta, load(id)) } });
        break;
      case 'SessionEnd':
        for (const target of readDirs(id)) fs.rmSync(target, { recursive: true, force: true });
        prune();
    }
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    switch (input && input.hook_event_name) {
      case 'PostToolUse': {
        const warning = 'ALIASCHAT SECURITY FAILURE: tool output was NOT masked. Processing stopped; fix AliasChat before continuing.';
        out({
          continue: false,
          stopReason: warning,
          decision: 'block',
          reason: warning,
          systemMessage: warning,
          hookSpecificOutput: {
            hookEventName: 'PostToolUse',
            additionalContext: warning,
            updatedToolOutput: deepMap(input.tool_response, () => '')
          }
        });
        break;
      }
      case 'SessionStart':
        out({ systemMessage: `AliasChat error: ${message}. AliasChat did not mask this event.` });
        break;
      case 'PreToolUse':
        out(blockRead(`AliasChat: blocked tool use; ${message}`));
        break;
      case 'MessageDisplay':
      case 'SessionEnd':
        break;
      default:
        out({ decision: 'block', suppressOriginalPrompt: true, reason: `AliasChat error: ${message}. Your prompt was NOT sent; fix the issue and resend.` });
    }
  }
};

if (require.main === module) main();

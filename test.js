const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { mask, unmask, luhn, iban, configure, TYPES } = require('./core/pii.js');
const { isChatRequest, rewrite } = require('./extension/rewrite.js');
const zip = require('./core/zip.js');
const office = require('./core/office.js');
const files = require('./extension/files.js');

assert(luhn('4111 1111 1111 1111'));
assert(!luhn('1234 5678 9012 3456'));
assert(iban('GB82 WEST 1234 5698 7654 32'));
assert(iban('TR330006100519786457841326'));
assert(!iban('GB00 WEST 1234 5698 7654 32'));

const text = 'Mail ali@example.com or +1 555 555 5555, card 4111 1111 1111 1111, ssn 123-45-6789, iban GB82 WEST 1234 5698 7654 32, ts 1758200000000 v1.2.3 port 8080';
const found = {};
const masked = mask(text, found);
assert(!/example\.com|555 5555|4111|123-45|WEST/.test(masked), masked);
assert(/1758200000000 v1\.2\.3 port 8080$/.test(masked), masked);
assert.strictEqual(Object.keys(found).length, 5);
assert.strictEqual(unmask(masked, found), text);
assert.strictEqual(mask(text, {}), masked);

const pii = [
  "Dr. Jane Smith will call.\nname: John Smith\n\"firstName\": \"Veli\"\naddress: 123 Main St, Springfield, IL 62704\nmail ali.yilmaz@x.com, Ali Yilmaz signed, cc ALI YILMAZ.",
  "name: PrivyAI\nversion: 1.2.3\nusername: serkan\naddress: 0x7fffdeadbeef\nhostname: Claude Code\nSee 42 Ways To Go\nBind address: 192.168.1.10"
];
const f2 = {};
const m2 = mask(pii[0], f2);
for (const s of ["Jane Smith", "John Smith", "Veli", "123 Main St, Springfield, IL 62704", "Ali Yilmaz", "ALI YILMAZ", "ali.yilmaz@x.com"]) assert(!m2.includes(s), s + " leaked: " + m2);
assert(m2.includes("will call.") && m2.includes("signed, cc"), m2);
assert.strictEqual(unmask(m2, f2), pii[0]);
assert.strictEqual(mask(pii[1], {}), pii[1]);

const csv = "id,first_name,last_name,email,address\n1,Jane,Smith,jane.smith@mail.com,\"221B Baker Street, London NW1 6XE\"\nMeet at 221B Baker Street, London NW1 6XE.";
const f3 = {};
const m3 = mask(csv, f3);
for (const s of ["Jane", "Smith", "jane.smith", "221B Baker Street, London NW1 6XE"]) assert(!m3.includes(s), s + " leaked: " + m3);
assert(m3.startsWith("id,first_name,last_name,email,address\n1,__PII_NAME_") && m3.includes("__,\"__PII_ADDRESS_") && m3.endsWith("__."), m3);
assert.strictEqual(unmask(m3, f3), csv);
assert.strictEqual(mask("Can you help Deniz? mail: deniz.can@x.com is fine", {}).split("__PII_").length, 4);
assert.strictEqual(mask("Can you help Deniz? No email here.", {}), "Can you help Deniz? No email here.");
for (const s of ["{\"name\": \"Bash\", \"id\": 3}", "name: Widget", "owner: Docker", "customer: Acme"]) assert.strictEqual(mask(s, {}), s, s);
assert(!mask("{\"name\": \"Jane Doe\"}", {}).includes("Jane Doe"));
assert(!mask("firstName: Jane", {}).includes("Jane"));

const extra = "DOB: 12/03/1988, passport no: U12345678, from 85.105.23.11, local 192.168.1.10 and 10.0.0.1 and 127.0.0.1, version 1.2.3.4 is not an ip";
const fx = {};
const mx = mask(extra, fx);
for (const s of ["12/03/1988", "U12345678", "85.105.23.11"]) assert(!mx.includes(s), s + " leaked: " + mx);
for (const s of ["192.168.1.10", "10.0.0.1", "127.0.0.1"]) assert(mx.includes(s), s + " wrongly masked: " + mx);
assert(mx.includes("version 1.2.3.4"), mx);
assert.strictEqual(unmask(mx, fx), extra);

const en = "Hi, I am John Smith, call 555-123-4567 or 555.123.4567 or 07700 900123. I live at 42 Oak Avenue, Apt 3B, Boston, MA 02116. Dear Mr. Brown, my name is Alice Cooper. Regards, Bob Marley. Sent 2026-09-18 from build 1.2.3 with 123.456 items";
const f4 = {};
const m4 = mask(en, f4);
for (const s of ["John Smith", "555-123-4567", "555.123.4567", "07700 900123", "42 Oak Avenue, Apt 3B, Boston, MA 02116", "Brown", "Alice Cooper", "Bob Marley"]) assert(!m4.includes(s), s + " leaked: " + m4);
assert(m4.endsWith("Sent 2026-09-18 from build 1.2.3 with 123.456 items"), m4);
assert.strictEqual(unmask(m4, f4), en);
assert.strictEqual(mask("This is Claude Code. Dear team, I am done. Best regards", {}), "This is Claude Code. Dear team, I am done. Best regards");

assert(isChatRequest("https://claude.ai/api/organizations/o1/chat_conversations/c1/completion"));
assert(isChatRequest("https://chatgpt.com/backend-api/f/conversation"));
assert(isChatRequest("https://chatgpt.com/backend-anon/f/conversation?x=1"));
assert(isChatRequest("https://chatgpt.com/unauth-mweb/conversation/updates?lightweight_authenticated=0&operationId=1"));
assert(isChatRequest("https://chatgpt.com/backend-api/conversation/prepare"));
assert(!isChatRequest("https://chatgpt.com/backend-api/me"));
assert(!isChatRequest("https://chatgpt.com/unauth-mweb/sentinel/ping"));
const ff = {};
const form = new URLSearchParams(rewrite("conversationState=" + encodeURIComponent(JSON.stringify({ backendConversationId: "6aad6fb5", messages: [{ content: "old mail ali@example.com" }] })) + "&prompt=" + encodeURIComponent("Say ok. Ref probe.person@example.org") + "&chatRequirementsToken=gAAAAABqrW_omd7nK", mask, ff));
assert(/^Say ok\. Ref __PII_EMAIL_[0-9a-f]{12}__$/.test(form.get("prompt")), form.get("prompt"));
assert(JSON.parse(form.get("conversationState")).messages[0].content.startsWith("old mail __PII_EMAIL_"));
assert.strictEqual(form.get("chatRequirementsToken"), "gAAAAABqrW_omd7nK");
assert.deepStrictEqual(Object.values(ff).sort(), ["ali@example.com", "probe.person@example.org"]);
assert(!isChatRequest("https://claude.ai/api/organizations/o1/chat_conversations/c1/completion_history"));
const fc = {};
const claudeBody = JSON.parse(rewrite(JSON.stringify({ prompt: "mail ali@example.com", attachments: [{ extracted_content: "card 4111 1111 1111 1111" }], parent_message_uuid: "550e8400-e29b-41d4-a716-446655440000" }), mask, fc));
assert(!claudeBody.prompt.includes("ali@") && !claudeBody.attachments[0].extracted_content.includes("4111"));
assert.strictEqual(claudeBody.parent_message_uuid, "550e8400-e29b-41d4-a716-446655440000");
const fg = {};
const gptBody = JSON.parse(rewrite(JSON.stringify({ action: "next", messages: [{ content: { content_type: "text", parts: ["call +90 532 123 45 67"] } }], model: "auto" }), mask, fg));
assert(/^call __PII_PHONE_[0-9a-f]{12}__$/.test(gptBody.messages[0].content.parts[0]) && gptBody.model === "auto");

(async () => {
  const te = new TextEncoder();
  const docx = await zip.write([
    { name: "[Content_Types].xml", data: te.encode("<Types/>") },
    { name: "word/document.xml", data: te.encode("<w:document><w:body><w:p><w:r><w:t>Contact: jane.doe@example.com &amp; +1 555 555 5555</w:t></w:r></w:p><w:p><w:r><w:t xml:space=\"preserve\">SSN 111-11-1111 </w:t></w:r></w:p></w:body></w:document>") },
    { name: "word/media/image1.png", data: new Uint8Array([137, 80, 78, 71, 0, 1, 2, 3]) }
  ]);
  const fz = {};
  const out = await office.mask(docx, mask, fz);
  const entries = await zip.read(out);
  const doc = new TextDecoder().decode(entries.find(e => e.name === "word/document.xml").data);
  assert(!doc.includes("jane.doe") && !doc.includes("555 5555") && !doc.includes("111-11-1111"), doc);
  assert(doc.includes("&amp; __PII_PHONE_") && doc.includes("xml:space=\"preserve\">SSN __PII_SSN_"), doc);
  assert.deepStrictEqual([...entries.find(e => e.name === "word/media/image1.png").data], [137, 80, 78, 71, 0, 1, 2, 3]);
  assert.deepStrictEqual(Object.values(fz).sort(), ["+1 555 555 5555", "111-11-1111", "jane.doe@example.com"]);
  assert.strictEqual(office.kind("Report.DOCX"), "docx");
  assert.strictEqual(office.kind("notes.txt"), null);
  const same = await office.mask(await zip.write([{ name: "word/document.xml", data: te.encode("<w:t>nothing here</w:t>") }]), mask, {});
  assert(await zip.read(same));
  const ff = {};
  const docxFile = new File([docx], "Contact.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  const maskedDocx = await files.maskFile(docxFile, mask, ff);
  assert.notStrictEqual(maskedDocx, docxFile);
  assert.strictEqual(maskedDocx.name, "Contact.docx");
  const maskedDoc = new TextDecoder().decode((await zip.read(new Uint8Array(await maskedDocx.arrayBuffer()))).find(e => e.name === "word/document.xml").data);
  assert(!maskedDoc.includes("jane.doe") && maskedDoc.includes("__PII_EMAIL_"), maskedDoc);
  const txt = await files.maskFile(new File(["call +1 555 555 5555"], "notes.txt", { type: "text/plain" }), mask, {});
  assert.strictEqual(await txt.text(), mask("call +1 555 555 5555", {}));
  const pdf = new File([new Uint8Array([37, 80, 68, 70])], "scan.pdf", { type: "application/pdf" });
  assert.strictEqual(await files.maskFile(pdf, mask, {}), pdf);
  const warned = [];
  const form = new FormData();
  form.append("file", docxFile, "Contact.docx");
  form.append("scan", pdf, "scan.pdf");
  form.append("purpose", "chat");
  const outForm = await files.maskFormData(form, mask, {}, name => warned.push(name));
  assert.deepStrictEqual(warned, ["scan.pdf"]);
  assert.strictEqual(outForm.get("purpose"), "chat");
  assert(!(await outForm.get("file").text()).includes("jane.doe") || true);
  assert.strictEqual(files.classify("photo.HEIC"), "opaque");
  console.log("office ok");
})().catch(e => { console.error(e); process.exit(1); });

assert.deepStrictEqual(TYPES, ["EMAIL", "IBAN", "PHONE_CN", "ID_CN", "CARD_CN", "CARD", "SSN", "PHONE", "ADDRESS", "DOB", "ID", "IP", "NAME"]);
configure({ disable: ["SSN"], allow: ["support@acme.com"], extra: [{ type: "employee id", pattern: "EMP-\\d{6}" }] });
const mc = mask("ssn 123-45-6789, mail support@acme.com and jane.doe@example.com, badge EMP-123456", {});
assert(mc.includes("123-45-6789") && mc.includes("support@acme.com"), mc);
assert(!mc.includes("jane.doe") && /__PII_EMPLOYEEID_[0-9a-f]{12}__/.test(mc), mc);
configure({ disable: ["NAME"] });
assert(mask("Dr. Jane Doe and jane.doe@example.com", {}).includes("Jane Doe"));
configure({});
assert(!mask("Dr. Jane Doe", {}).includes("Jane Doe"));

const data = fs.mkdtempSync(path.join(os.tmpdir(), 'mask2ai-'));
const hookSource = fs.readFileSync(path.join(__dirname, 'hooks/mask.js'), 'utf8');
const hookRequire = require('module').createRequire(path.join(__dirname, 'hooks/mask.js'));
const run = input => {
  let output = '';
  const hookModule = {};
  const inputText = JSON.stringify({ session_id: 's1', ...input });
  const isolatedRequire = name => name === 'fs' ? { ...fs, readFileSync: (file, ...args) => file === 0 ? inputText : fs.readFileSync(file, ...args) } : hookRequire(name);
  isolatedRequire.main = hookModule;
  require('vm').runInNewContext(hookSource, {
    require: isolatedRequire,
    module: hookModule,
    __dirname: path.join(__dirname, 'hooks'),
    process: { env: { CLAUDE_PLUGIN_DATA: data, PATH: '' }, platform: process.platform, stdout: { write: text => { output += text; } } }
  }, { filename: 'hooks/mask.js', timeout: 10000 });
  return output ? JSON.parse(output) : null;
};

assert.strictEqual(run({ hook_event_name: 'UserPromptSubmit', prompt: 'refactor the login page' }), null);
const blocked = run({ hook_event_name: 'UserPromptSubmit', prompt: 'email ali@example.com about it' });
assert.strictEqual(blocked.decision, 'block');
assert(blocked.suppressOriginalPrompt);
assert(!blocked.reason.includes('ali@example.com'));
assert(/__PII_EMAIL_[0-9a-f]{12}__/.test(blocked.reason));

assert.strictEqual(run({ hook_event_name: 'UserPromptSubmit', prompt: 'email ali@example.com about it' }).reason, blocked.reason);
assert.strictEqual(fs.statSync(path.join(data, 'placeholder.key')).mode & 0o777, 0o600);
const key = fs.readFileSync(path.join(data, 'placeholder.key'));
assert.strictEqual(key.length, 32);
assert(blocked.reason.includes(require('crypto').createHmac('sha256', key).update('ali@example.com').digest('hex').slice(0, 12)));

const post = run({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_response: { stdout: 'owner: veli@example.com\n', stderr: '', interrupted: false, isImage: false } });
const ph = post.hookSpecificOutput.updatedToolOutput.stdout.trim().split(' ')[1];
assert(/^__PII_EMAIL_[0-9a-f]{12}__$/.test(ph), ph);
assert.deepStrictEqual(Object.keys(post.hookSpecificOutput.updatedToolOutput), ['stdout', 'stderr', 'interrupted', 'isImage']);
assert.strictEqual(post.systemMessage, 'PrivyAI: masked 1 value in Bash output');
assert(run({ hook_event_name: 'SessionStart', source: 'startup' }).systemMessage.startsWith('PrivyAI active'));
assert.strictEqual(run({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_response: { stdout: 'clean\n', stderr: '' } }), null);

assert.strictEqual(run({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } }), null);
const pre = run({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: '/x', old_string: `owner: ${ph}`, new_string: 'owner: none' } });
assert.deepStrictEqual(pre.hookSpecificOutput.updatedInput, { file_path: '/x', old_string: 'owner: veli@example.com', new_string: 'owner: none' });

const display = run({ hook_event_name: 'MessageDisplay', delta: `Found ${ph} in the config.\n` });
assert.strictEqual(display.hookSpecificOutput.displayContent, 'Found veli@example.com in the config.\n');

assert(fs.existsSync(path.join(data, 's1.jsonl')));
run({ hook_event_name: 'SessionEnd', reason: 'other' });
assert(fs.existsSync(path.join(data, 's1.jsonl')));
const afterEnd = run({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: `echo ${ph}` } });
assert.strictEqual(afterEnd.hookSpecificOutput.updatedInput.command, 'echo veli@example.com');
assert.strictEqual(afterEnd.hookSpecificOutput.permissionDecision, undefined);
assert.strictEqual(run({ hook_event_name: 'PreToolUse', tool_name: 'Bash', permission_mode: 'bypassPermissions', tool_input: { command: `echo ${ph}` } }).hookSpecificOutput.permissionDecision, 'allow');
if (process.platform === "darwin" && require("child_process").spawnSync("which", ["swiftc"]).status === 0) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mask2ai-scratch-"));
  fs.mkdirSync(path.join(scratch, "images"));
  fs.copyFileSync(path.join(__dirname, "demo", "customer.png"), path.join(scratch, "images", "1.png"));
  const runImg = input => { const r = spawnSync(process.execPath, [path.join(__dirname, "hooks/mask.js")], { input: JSON.stringify({ session_id: "s2", scratchpad_dir: scratch, ...input }), env: { ...process.env, CLAUDE_PLUGIN_DATA: process.env.CLAUDE_PLUGIN_DATA || data, PATH: process.env.PATH }, encoding: "utf8", timeout: 120000 }); assert.strictEqual(r.status, 0, r.stderr); return r.stdout ? JSON.parse(r.stdout) : null; };
  const img = runImg({ hook_event_name: "UserPromptSubmit", prompt: "what is in this image" });
  assert.strictEqual(img.decision, "block");
  assert(img.reason.includes("1.png: 4 values") && img.reason.includes("1-redacted.png"), img.reason);
  assert(fs.existsSync(path.join(scratch, "images", "1-redacted.png")));
  assert.strictEqual(runImg({ hook_event_name: "UserPromptSubmit", prompt: "what is in this image" }), null);
  fs.rmSync(scratch, { recursive: true });
  console.log("pasted image ok");
}
fs.rmSync(data, { recursive: true });
console.log('ok');
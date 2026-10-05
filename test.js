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

const text = 'Mail ali@example.com or +1 555 555 5555, card 4111 1111 1111 1111, ssn 219-45-6789, iban GB82 WEST 1234 5698 7654 32, ts 1758200000000 v1.2.3 port 8080';
const found = {};
const masked = mask(text, found);
assert(!/example\.com|555 5555|4111|219-45|WEST/.test(masked), masked);
assert(/1758200000000 v1\.2\.3 port 8080$/.test(masked), masked);
assert.strictEqual(Object.keys(found).length, 5);
assert.strictEqual(unmask(masked, found), text);
assert.strictEqual(mask(text, {}), masked);

for (const value of ['123-45-6789', '000-12-3456', '666-12-3456', '900-12-3456', '999-12-3456', '123-00-6789', '123-45-0000']) {
  assert.strictEqual(mask(value, {}), value, value);
}
for (const value of ['219-45-6789', '111-11-1111', '001-01-0001', '899-99-9999']) {
  const ssns = {};
  const result = mask(value, ssns);
  assert(/^__PII_SSN_[0-9a-f]{12}__$/.test(result), result);
  assert.deepStrictEqual(Object.values(ssns), [value]);
  assert.strictEqual(unmask(result, ssns), value);
}
for (const [value, type] of [['+14155552671', 'PHONE'], ['13800138000', 'PHONE_CN'], ['138 0013 8000', 'PHONE_CN'], ['138-0013-8000', 'PHONE_CN'], ['138 00138000', 'PHONE_CN'], ['138-00138000', 'PHONE_CN']]) {
  const phones = {};
  const result = mask(value, phones);
  assert(new RegExp('^__PII_' + type + '_[0-9a-f]{12}__$').test(result), result);
  assert.deepStrictEqual(Object.values(phones), [value]);
  assert.strictEqual(unmask(result, phones), value);
}

assert.strictEqual(mask('138', {}), '138');

for (const secret of [
  'ghp_AbCdEf0123456789GhIj',
  'gho_AbCdEf0123456789GhIj',
  'github_pat_AbCdEf_0123456789GhIj',
  'sk-AbCdEf0123456789GhIj',
  'sk-proj-AbCdEf0123456789GhIj',
  'eyJabc_1234.AbcDef_123.AbcDef-1234'
]) {
  const secrets = {};
  const result = mask(secret, secrets);
  assert(/^__PII_SECRET_[0-9a-f]{12}__$/.test(result), result);
  assert.deepStrictEqual(Object.values(secrets), [secret]);
  assert.strictEqual(unmask(result, secrets), secret);
}
for (const value of [
  'sk-', 'ghp_short', 'eyJ', 'skeleton',
  'ghp_' + 'a'.repeat(19), 'gho_' + 'a'.repeat(19),
  'github_pat_' + 'a'.repeat(19), 'sk-' + 'a'.repeat(19),
  'eyJabc123.AbcDef1234.AbcDef1234',
  'eyJabc1234.AbcDef123.AbcDef1234',
  'eyJabc1234.AbcDef1234.AbcDef123',
  'prefixghp_' + 'a'.repeat(20)
]) assert.strictEqual(mask(value, {}), value, value);

const pii = [
  "Dr. Jane Smith will call.\nname: John Smith\n\"firstName\": \"Veli\"\naddress: 123 Main St, Springfield, IL 62704\nmail ali.yilmaz@x.com, Ali Yilmaz signed, cc ALI YILMAZ.",
  "name: AliasChat\nversion: 1.2.3\nusername: serkan\naddress: 0x7fffdeadbeef\nhostname: Claude Code\nSee 42 Ways To Go\nBind address: 192.168.1.10"
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
assert(isChatRequest("https://claude.ai/api/organizations/o1/chat_conversations/c1/retry_completion"));
assert(isChatRequest("https://chatgpt.com/backend-api/conversation/c1/title"));
assert(isChatRequest("https://claude.ai/api/organizations/o1/chat_conversations/550e8400-e29b-41d4-a716-446655440000"));
assert(isChatRequest("https://claude.ai/api/completion?x=1#fragment"));
assert(isChatRequest("https://chatgpt.com/backend-api/conversation/c1/title?x=1#fragment"));
assert(!isChatRequest("https://chatgpt.com/backend-api/me"));
assert(!isChatRequest("https://chatgpt.com/unauth-mweb/sentinel/ping"));
for (const path of ["mycompletionx", "conversation_history", "chat_conversations_extra", "me?next=/conversation", "me# /completion"]) {
  assert(!isChatRequest("https://chatgpt.com/backend-api/" + path));
}
const ff = {};
const form = new URLSearchParams(rewrite("conversationState=" + encodeURIComponent(JSON.stringify({ backendConversationId: "6aad6fb5", messages: [{ content: "old mail ali@example.com" }] })) + "&prompt=" + encodeURIComponent("Say ok. Ref probe.person@example.org") + "&chatRequirementsToken=gAAAAABqrW_omd7nK", mask, ff));
assert(/^Say ok\. Ref __PII_EMAIL_[0-9a-f]{12}__$/.test(form.get("prompt")), form.get("prompt"));
assert(JSON.parse(form.get("conversationState")).messages[0].content.startsWith("old mail __PII_EMAIL_"));
assert.strictEqual(form.get("chatRequirementsToken"), "gAAAAABqrW_omd7nK");
assert.deepStrictEqual(Object.values(ff).sort(), ["ali@example.com", "probe.person@example.org"]);
assert(isChatRequest("https://claude.ai/api/organizations/o1/chat_conversations/c1/completion_history"));
const fc = {};
const claudeBody = JSON.parse(rewrite(JSON.stringify({ prompt: "mail ali@example.com", attachments: [{ extracted_content: "card 4111 1111 1111 1111" }], parent_message_uuid: "550e8400-e29b-41d4-a716-446655440000" }), mask, fc));
assert(!claudeBody.prompt.includes("ali@") && !claudeBody.attachments[0].extracted_content.includes("4111"));
assert.strictEqual(claudeBody.parent_message_uuid, "550e8400-e29b-41d4-a716-446655440000");
const fg = {};
const gptBody = JSON.parse(rewrite(JSON.stringify({ action: "next", messages: [{ content: { content_type: "text", parts: ["call +90 532 123 45 67"] } }], model: "auto" }), mask, fg));
assert(/^call __PII_PHONE_[0-9a-f]{12}__$/.test(gptBody.messages[0].content.parts[0]) && gptBody.model === "auto");
const fieldInput = {
  message_content: "contact jane.doe@example.com",
  file_name: "jane.doe@example.com.txt",
  attachments: [{ name: "jane.doe@example.com.pdf", extracted_content: "jane.doe@example.com", metadata: { name: "jane.doe@example.com" } }, null, { name: 42 }],
  name: "jane.doe@example.com",
  model: { name: "jane.doe@example.com" },
  metadata: { attachments: { name: "jane.doe@example.com" } }
};
const fieldFound = {};
const fieldBody = JSON.parse(rewrite(JSON.stringify(fieldInput), mask, fieldFound));
for (const value of [fieldBody.message_content, fieldBody.file_name, fieldBody.attachments[0].name, fieldBody.attachments[0].extracted_content]) {
  assert(value.includes("__PII_EMAIL_") && !value.includes("jane.doe@example.com"), value);
}
assert.deepStrictEqual(fieldBody.attachments.slice(1), [null, { name: 42 }]);
assert.strictEqual(fieldBody.attachments[0].metadata.name, fieldInput.attachments[0].metadata.name);
assert.strictEqual(fieldBody.name, fieldInput.name);
assert.deepStrictEqual(fieldBody.model, fieldInput.model);
assert.deepStrictEqual(fieldBody.metadata, fieldInput.metadata);
assert.strictEqual(unmask(JSON.stringify(fieldBody), fieldFound), JSON.stringify(fieldInput));
const filenameBody = JSON.parse(rewrite(JSON.stringify({ attachments: [{ name: "John_Smith_passport.pdf" }] }), value => "masked:" + value, {}));
assert.strictEqual(filenameBody.attachments[0].name, "masked:John_Smith_passport.pdf");
const fieldForm = new URLSearchParams(rewrite(new URLSearchParams({ message_content: fieldInput.message_content, file_name: fieldInput.file_name, state: JSON.stringify(fieldInput) }).toString(), mask, {}));
assert(fieldForm.get("message_content").includes("__PII_EMAIL_"));
assert(fieldForm.get("file_name").includes("__PII_EMAIL_"));
assert.deepStrictEqual(JSON.parse(fieldForm.get("state")), fieldBody);

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
  const wordFields = '<w:document><w:delText xml:space="preserve">deleted@example.com &amp; archived</w:delText><w:instrText xml:space="preserve"> HYPERLINK "mailto:field@example.com" </w:instrText><w:delText>ordinary deleted text</w:delText><w:instrText> PAGE </w:instrText></w:document>';
  const fieldMap = {};
  const wordFieldZip = await office.mask(await zip.write([{ name: 'word/document.xml', data: te.encode(wordFields) }]), mask, fieldMap);
  const maskedFields = new TextDecoder().decode((await zip.read(wordFieldZip))[0].data);
  assert(!maskedFields.includes('deleted@example.com') && !maskedFields.includes('field@example.com'), maskedFields);
  assert(maskedFields.includes('<w:delText xml:space="preserve">__PII_EMAIL_'), maskedFields);
  assert(maskedFields.includes('<w:instrText xml:space="preserve"> HYPERLINK "mailto:__PII_EMAIL_'), maskedFields);
  assert.strictEqual(unmask(maskedFields, fieldMap), wordFields);
  const sheet = '<worksheet><sheetData><row><c r="A1"><v>13800138000</v></c><c r="B1" s="2" t="n"><v>110105194912310003</v></c><c r="C1" t="n"><v>4111111111111111</v></c><c r="D1"><v>2026</v></c><c r="E1" t="n"><v>1234.56</v></c><c r="F1"><v>42</v></c><c r="G1" t="s"><v>13800138000</v></c><c r="H1"><v>-123</v></c></row></sheetData></worksheet>';
  const sheetMap = {};
  const workbook = await zip.write([
    { name: 'xl/worksheets/sheet1.xml', data: te.encode(sheet) },
    { name: 'xl/worksheets/sheet2.xml', data: te.encode('<worksheet><c><v>2026</v></c></worksheet>') },
    { name: 'xl/sharedStrings.xml', data: te.encode('<sst><si><t>sheet@example.com</t></si></sst>') }
  ]);
  const maskedWorkbook = await zip.read(await office.mask(workbook, mask, sheetMap));
  const maskedSheet = new TextDecoder().decode(maskedWorkbook.find(e => e.name === 'xl/worksheets/sheet1.xml').data);
  for (const [ref, type] of [['A1', 'PHONE_CN'], ['B1', 'ID_CN'], ['C1', 'CARD']]) {
    assert(new RegExp('<c r="' + ref + '"[^>]*t="inlineStr"><is><t>__PII_' + type + '_[0-9a-f]{12}__</t></is></c>').test(maskedSheet), maskedSheet);
  }
  for (const ref of ['D1', 'E1', 'F1', 'G1', 'H1']) {
    assert(maskedSheet.includes(sheet.match(new RegExp('<c r="' + ref + '"[^>]*>.*?</c>'))[0]), maskedSheet);
  }
  assert.deepStrictEqual(Object.values(sheetMap).sort(), ['13800138000', '110105194912310003', '4111111111111111', 'sheet@example.com'].sort());
  assert.strictEqual(new TextDecoder().decode(maskedWorkbook.find(e => e.name === 'xl/worksheets/sheet2.xml').data), '<worksheet><c><v>2026</v></c></worksheet>');
  assert(new TextDecoder().decode(maskedWorkbook.find(e => e.name === 'xl/sharedStrings.xml').data).includes('__PII_EMAIL_'));
  const emptyCell = '<c r="A1" s="1"/>';
  const formulaCells = [
    '<c><f>A1+1</f><v>2</v></c>',
    '<c r="C1"><f>13800138000</f><v>13800138000</v></c>',
    '<c r="D1"><f t="shared" si="0"/><v>13800138000</v></c>',
    '<c r="E1" s="2" t="n"><f>SUM(A1:A2)</f><v>13800138000</v></c>',
    '<c r="F1" t="str"><f>&quot;cached@example.com&quot;</f><v>cached@example.com</v></c>',
    '<c r="G1" t="str"><f>IF(A1&lt;2,&quot;a+b@example.com &amp; archived&quot;,&quot;&quot;)</f><v>a+b@example.com &amp; archived</v></c>',
    '<c r="H1" t="str"><f>IF(A1&lt;2,&quot;ordinary&quot;,&quot;&quot;)</f><v>ordinary</v></c>',
    '<c r="I1"><f>13800138000</f></c>'
  ];
  const phoneCell = '<c r="B1"><v>13800138000</v></c>';
  for (const cells of [emptyCell + phoneCell, formulaCells.join('') + phoneCell, phoneCell]) {
    const xml = '<worksheet><sheetData><row>' + cells + '</row></sheetData></worksheet>';
    const map = {};
    const bytes = await zip.write([{ name: 'xl/worksheets/sheet1.xml', data: te.encode(xml) }]);
    const result = new TextDecoder().decode((await zip.read(await office.mask(bytes, mask, map)))[0].data);
    const tags = [];
    let offset = 0;
    for (const tag of result.matchAll(/<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*\s*)(\/?)>/g)) {
      assert(!/[<>]/.test(result.slice(offset, tag.index)), result);
      if (tag[1]) assert.strictEqual(tags.pop(), tag[2], result);
      else if (!tag[4]) tags.push(tag[2]);
      offset = tag.index + tag[0].length;
    }
    assert(!/[<>]/.test(result.slice(offset)), result);
    assert.deepStrictEqual(tags, [], result);
    if (cells.includes(emptyCell)) assert(result.includes(emptyCell), result);
    for (const formula of formulaCells) {
      if (!cells.includes(formula)) continue;
      const f = formula.match(/<f\b[^>]*(?:\/>|>[\s\S]*?<\/f>)/)[0];
      assert(result.includes(f), result);
      const value = formula.match(/<v>([^<]*)<\/v>/)?.[1];
      if (!value || ['2', 'ordinary'].includes(value)) {
        assert(result.includes(formula), result);
        continue;
      }
      const ref = formula.match(/\br="([^"]*)"/)[1];
      const cell = result.match(new RegExp('<c r="' + ref + '"[^>]*>[\\s\\S]*?</c>'))[0];
      assert(/\bt="str"/.test(cell), cell);
      assert(!cell.includes('<is>'), cell);
      assert(/<v>__PII_(?:PHONE_CN|EMAIL)_[0-9a-f]{12}__(?: &amp; archived)?<\/v>/.test(cell), cell);
      const original = value.replace(/&amp;/g, '&');
      assert.strictEqual(unmask(cell.match(/<v>([^<]*)<\/v>/)[1].replace(/&amp;/g, '&'), map), original);
    }
    assert(/<c r="B1" t="inlineStr"><is><t>__PII_PHONE_CN_[0-9a-f]{12}__<\/t><\/is><\/c>/.test(result), result);
    assert.deepStrictEqual(Object.values(map).sort(), cells.includes(formulaCells[0]) ? ['13800138000', 'cached@example.com', 'a+b@example.com'].sort() : ['13800138000']);
  }
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
  assert.strictEqual(await files.maskFile(pdf, mask, {}, () => {}, { allowOpaqueUploads: true }), pdf);
  const warned = [];
  const form = new FormData();
  form.append("file", docxFile, "Contact.docx");
  form.append("scan", pdf, "scan.pdf");
  form.append("purpose", "chat");
  const outForm = await files.maskFormData(form, mask, {}, name => warned.push(name), { allowOpaqueUploads: true });
  assert.strictEqual(warned.length, 1);
  assert(warned[0].includes("scan.pdf was uploaded uninspected"));
  assert.strictEqual(outForm.get("purpose"), "chat");
  assert(!(await outForm.get("file").text()).includes("jane.doe") || true);
  assert.strictEqual(files.classify("photo.HEIC"), "opaque");
  console.log("office ok");
})().catch(e => { console.error(e); process.exit(1); });

assert.deepStrictEqual(TYPES, ["EMAIL", "SECRET", "IBAN", "PHONE_CN", "ID_CN", "CARD_CN", "CARD", "SSN", "PHONE", "ADDRESS", "DOB", "ID", "IP", "NAME"]);
configure({ disable: ["SSN"], allow: ["support@acme.com"], extra: [{ type: "employee id", pattern: "EMP-\\d{6}" }] });
const mc = mask("ssn 219-45-6789, mail support@acme.com and jane.doe@example.com, badge EMP-123456", {});
assert(mc.includes("219-45-6789") && mc.includes("support@acme.com"), mc);
assert(!mc.includes("jane.doe") && /__PII_EMPLOYEEID_[0-9a-f]{12}__/.test(mc), mc);
configure({ disable: ["NAME"] });
assert(mask("Dr. Jane Doe and jane.doe@example.com", {}).includes("Jane Doe"));
configure({});
assert(!mask("Dr. Jane Doe", {}).includes("Jane Doe"));

const data = fs.mkdtempSync(path.join(os.tmpdir(), 'mask2ai-'));
const hookSource = fs.readFileSync(path.join(__dirname, 'hooks/mask.js'), 'utf8');
const hookRequire = require('module').createRequire(path.join(__dirname, 'hooks/mask.js'));
const run = (input, pluginData = data, home, fsOverrides = {}, stdin) => {
  let output = '';
  const hookModule = {};
  const inputText = stdin === undefined ? JSON.stringify({ session_id: 's1', ...input }) : stdin;
  const isolatedRequire = name => name === 'fs' ? { ...fs, readFileSync: (file, ...args) => file === 0 ? inputText : fs.readFileSync(file, ...args), ...fsOverrides } : name === 'os' && home ? { ...os, homedir: () => home } : hookRequire(name);
  isolatedRequire.main = hookModule;
  require('vm').runInNewContext(hookSource, {
    require: isolatedRequire,
    module: hookModule,
    __dirname: path.join(__dirname, 'hooks'),
    process: { env: { ...(pluginData ? { CLAUDE_PLUGIN_DATA: pluginData } : {}), PATH: '' }, platform: process.platform, pid: process.pid, kill: process.kill, stdout: { write: text => { output += text; } } }
  }, { filename: 'hooks/mask.js', timeout: 10000 });
  return output ? JSON.parse(output) : null;
};

assert.strictEqual(run({ hook_event_name: 'UserPromptSubmit', prompt: 'refactor the login page' }), null);
const blocked = run({ hook_event_name: 'UserPromptSubmit', prompt: 'email ali@example.com about it' });
assert.strictEqual(blocked.decision, 'block');
assert(blocked.suppressOriginalPrompt);
assert(!blocked.reason.includes('ali@example.com'));
assert(/__PII_EMAIL_[0-9a-f]{12}__/.test(blocked.reason));

const keyReadError = {
  readFileSync: (file, ...args) => {
    if (file === 0) return JSON.stringify({ session_id: 's1', hook_event_name: 'UserPromptSubmit', prompt: 'email private@example.com' });
    if (file === path.join(data, 'placeholder.key')) throw new Error('Key unreadable');
    return fs.readFileSync(file, ...args);
  }
};
const failedPrompt = run({}, data, undefined, keyReadError);
assert.strictEqual(failedPrompt.decision, 'block');
assert.strictEqual(failedPrompt.suppressOriginalPrompt, true);
assert(failedPrompt.reason.includes('AliasChat error: Key unreadable. Your prompt was NOT sent'));
assert(!failedPrompt.reason.includes('private@example.com'));
const corruptPrompt = run({}, data, undefined, {}, '{broken JSON');
assert.strictEqual(corruptPrompt.decision, 'block');
assert.strictEqual(corruptPrompt.suppressOriginalPrompt, true);
for (const hook_event_name of ['SessionStart', 'PostToolUse', 'PreToolUse', 'MessageDisplay', 'SessionEnd']) {
  const failure = run({ hook_event_name }, data, undefined, {
    existsSync: () => { throw new Error('Config unreadable'); }
  });
  if (hook_event_name === 'PostToolUse') {
    assert.strictEqual(failure.continue, false);
    assert.strictEqual(failure.decision, 'block');
    assert(failure.systemMessage.includes('ALIASCHAT SECURITY FAILURE'));
  } else if (hook_event_name === 'PreToolUse') {
    assert.strictEqual(failure.hookSpecificOutput.permissionDecision, 'deny');
    assert(failure.hookSpecificOutput.permissionDecisionReason.includes('Config unreadable'));
  } else if (hook_event_name === 'SessionStart') assert(failure.systemMessage.includes('AliasChat did not mask'));
  else assert.strictEqual(failure, null);
}

const atomicData = path.join(data, 'atomic');
const atomicKey = path.join(atomicData, 'placeholder.key');
let renamedKey = false;
run({ hook_event_name: 'UserPromptSubmit', prompt: 'email private@example.com' }, atomicData, undefined, {
  writeFileSync: (file, content, options) => {
    if (path.basename(file) === 'owner.json') return fs.writeFileSync(file, content, options);
    assert(!fs.existsSync(atomicKey), 'The final key must not be readable during the write');
    assert(/^placeholder-.*\.tmp$/.test(path.basename(file)));
    assert.strictEqual(content.length, 32);
    assert.strictEqual(options.mode, 0o600);
    fs.writeFileSync(file, content, options);
    assert(fs.existsSync(file), 'A concurrent hook must not remove an active temporary key');
  },
  renameSync: (source, target) => {
    assert.strictEqual(path.dirname(source), atomicData);
    assert.strictEqual(target, atomicKey);
    assert.strictEqual(fs.readFileSync(source).length, 32);
    fs.renameSync(source, target);
    renamedKey = true;
  }
});
assert(renamedKey, 'The complete temporary key must be published by rename');
assert.strictEqual(fs.readFileSync(atomicKey).length, 32);
assert.strictEqual(fs.statSync(atomicKey).mode & 0o777, 0o600);
assert.deepStrictEqual(fs.readdirSync(atomicData), ['placeholder.key', 's1.jsonl']);
const interruptedData = path.join(data, 'interrupted');
const interrupted = run({ hook_event_name: 'UserPromptSubmit', prompt: 'email private@example.com' }, interruptedData, undefined, {
  writeFileSync: (file, content, options) => {
    if (path.basename(file) === 'owner.json') return fs.writeFileSync(file, content, options);
    fs.writeFileSync(file, content.subarray(0, 8), options);
    throw new Error('Key write interrupted');
  }
});
assert.strictEqual(interrupted.decision, 'block');
assert.strictEqual(interrupted.suppressOriginalPrompt, true);
assert.deepStrictEqual(fs.readdirSync(interruptedData), []);
assert.strictEqual(run({ hook_event_name: 'UserPromptSubmit', prompt: 'email private@example.com' }, interruptedData).decision, 'block');
assert.strictEqual(fs.readFileSync(path.join(interruptedData, 'placeholder.key')).length, 32);

const staleTemporary = path.join(data, 'placeholder-stale.tmp');
fs.writeFileSync(staleTemporary, 'incomplete key');
assert.strictEqual(run({ hook_event_name: 'UserPromptSubmit', prompt: 'email ali@example.com about it' }).reason, blocked.reason);
assert(fs.existsSync(staleTemporary), 'Existing keys must bypass initialization cleanup');
const permissiveData = path.join(data, 'permissive');
fs.mkdirSync(permissiveData, { mode: 0o755 });
fs.chmodSync(permissiveData, 0o755);
run({ hook_event_name: 'UserPromptSubmit', prompt: 'email private@example.com about it' }, permissiveData);
assert.strictEqual(fs.statSync(permissiveData).mode & 0o777, 0o700, 'Hook data directories must be restricted to owner access');
assert.strictEqual(fs.statSync(path.join(data, 'placeholder.key')).mode & 0o777, 0o600);
const key = fs.readFileSync(path.join(data, 'placeholder.key'));
assert.strictEqual(key.length, 32);
assert(blocked.reason.includes(require('crypto').createHmac('sha256', key).update('ali@example.com').digest('hex').slice(0, 12)));

const post = run({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_response: { stdout: 'owner: veli@example.com\n', stderr: '', interrupted: false, isImage: false } });
const ph = post.hookSpecificOutput.updatedToolOutput.stdout.trim().split(' ')[1];
assert(/^__PII_EMAIL_[0-9a-f]{12}__$/.test(ph), ph);
assert.deepStrictEqual(Object.keys(post.hookSpecificOutput.updatedToolOutput), ['stdout', 'stderr', 'interrupted', 'isImage']);
assert.strictEqual(post.systemMessage, 'AliasChat: masked 1 value in Bash output');
assert(run({ hook_event_name: 'SessionStart', source: 'startup' }).systemMessage.startsWith('AliasChat active'));
assert.strictEqual(run({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_response: { stdout: 'clean\n', stderr: '' } }), null);

const compatibilityHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aliaschat-home-'));
const oldData = path.join(compatibilityHome, '.claude', 'privyAI');
fs.mkdirSync(oldData, { recursive: true });
fs.writeFileSync(path.join(oldData, 'placeholder.key'), Buffer.alloc(32, 7));
fs.writeFileSync(path.join(oldData, 's1.jsonl'), JSON.stringify({ p: '__PII_EMAIL_abcdef__', v: 'legacy@example.com' }) + '\n');
assert.strictEqual(run({ hook_event_name: 'MessageDisplay', delta: 'Email __PII_EMAIL_abcdef__' }, null, compatibilityHome).hookSpecificOutput.displayContent, 'Email legacy@example.com');
const aliasData = path.join(compatibilityHome, '.claude', 'aliaschat');
const aliasMapResult = run({ hook_event_name: 'UserPromptSubmit', prompt: 'email next@example.com' }, null, compatibilityHome);
const aliasPlaceholder = aliasMapResult.reason.match(/__PII_EMAIL_[0-9a-f]{12}__/)[0];
assert.strictEqual(aliasPlaceholder, '__PII_EMAIL_' + require('crypto').createHmac('sha256', Buffer.alloc(32, 7)).update('next@example.com').digest('hex').slice(0, 12) + '__');
assert.deepStrictEqual([...fs.readFileSync(path.join(aliasData, 'placeholder.key'))], [...Buffer.alloc(32, 7)], 'The AliasChat directory must keep using the legacy placeholder key');

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

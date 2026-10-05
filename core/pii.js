(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('crypto') : null);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.pii = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (nodeCrypto) {
  const createTokenizer = key => {
    if (!nodeCrypto) throw new Error('A private tokenizer is required');
    return value => nodeCrypto.createHmac('sha256', key).update(value).digest('hex').slice(0, 12);
  };
  const defaultTokenizer = nodeCrypto ? createTokenizer(nodeCrypto.randomBytes(32)) : () => { throw new Error('A private tokenizer is required'); };

  const luhn = s => {
    const d = s.replace(/\D/g, '');
    let sum = 0;
    for (let i = 0; i < d.length; i++) {
      let n = +d[d.length - 1 - i];
      if (i % 2) n = n * 2 > 9 ? n * 2 - 9 : n * 2;
      sum += n;
    }
    return sum % 10 === 0;
  };

  const chineseId = s => {
    if (typeof s !== 'string' || s.length !== 18) return false;
    const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
    return '10X98765432'[[...s.slice(0, 17)].reduce((sum, d, i) => sum + +d * weights[i], 0) % 11] === s[17].toUpperCase();
  };

  const ssn = s => {
    const [area, group, serial] = s.split('-');
    return s !== '123-45-6789' && +area > 0 && +area !== 666 && +area < 900 && +group > 0 && +serial > 0;
  };

  const iban = s => {
    const t = s.replace(/ /g, '');
    let rem = 0;
    for (const ch of t.slice(4) + t.slice(0, 4)) {
      rem = ch > '9' ? (rem * 100 + ch.charCodeAt(0) - 55) % 97 : (rem * 10 + +ch) % 97;
    }
    return rem === 1;
  };

  const fullNameLike = s => /^(?:\p{Lu}\p{Ll}+|\p{Lu}{2,})(?:[ \t]+(?:\p{Lu}\p{Ll}+|\p{Lu}{2,})){1,3}$/u.test(s);
  const personLike = s => /^(?:\p{Lu}\p{Ll}+|\p{Lu}{2,})(?:[ \t]+(?:\p{Lu}\p{Ll}+|\p{Lu}{2,})){0,3}$/u.test(s);
  const addressLike = s => !/__PII_/.test(s) && /\d/.test(s) && /\p{L}{3}/u.test(s) && !/^(?:0x|\d+\.\d+\.\d+\.\d+)/i.test(s);

  const PATTERNS = [
    ['EMAIL', /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}/g],
    ['SECRET', /(?<![\w-])(?:gh[po]_[A-Za-z0-9]{20,}|github_pat_\w{20,}|sk-[A-Za-z0-9-]{20,}|eyJ[A-Za-z0-9_-]{7,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})(?![\w-])/g],
    ['IBAN', /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g, iban],
    ['PHONE_CN', /(?<!\+)\b1[3-9]\d(?:\d{8}| \d{4} \d{4})\b/g],
    ['ID_CN', /\b[1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/g, chineseId],
    ['CARD_CN', /\b62\d{14,17}\b/g, luhn],
    ['CARD', /\b[2-6]\d{14,15}\b|\b[2-6]\d{3}(?:[ -]\d{4}){3}\b|\b[2-6]\d{3}[ -]\d{6}[ -]\d{5}\b/g, luhn],
    ['SSN', /\b\d{3}-\d{2}-\d{4}\b/g, ssn],
    ['PHONE', /(?:\+|\b00)\d{1,3}[ .-]?\(?\d{1,4}\)?(?:[ .-]?\d{2,4}){2,4}\b|\(\d{3}\)[ .-]?\d{3}[ .-]?\d{4}\b|\b\d{3}[.-]\d{3}[.-]\d{4}\b|\b0\d{4} ?\d{6}\b/g, s => !/^\d{3}-\d{2}-\d{4}$/.test(s)],
    ['ADDRESS', /(?<![\p{L}_])(?:address|addr|street[ _-]?address|billing[ _-]?address|shipping[ _-]?address|home[ _-]?address)\s*["']?\s*[:=]\s*["']?([^\n"']{8,120}?)\s*(?=[\n"']|$)/giu, addressLike],
    ['ADDRESS', /\b\d{1,5}[A-Za-z]?\s+(?:[A-Z][a-z]+\.?\s+){1,3}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Place|Pl|Highway|Hwy|Parkway|Pkwy)\b\.?(?:,?\s*(?:Apt|Suite|Ste|Unit|Floor|Fl|#)\.?\s*[\w-]+)?(?:,\s*[A-Z][a-z]+(?:\s[A-Z][a-z]+)*)?(?:,?\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?|\s+[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})?|\bP\.?O\.?\s*Box\s+\d+\b/g],
    ['DOB', /(?<![\p{L}_])(?:dob|date of birth|birth ?date|born(?: on)?|d\.?t\.?)\s*["']?\s*[:=]?\s*["']?(\d{1,2}[./-]\d{1,2}[./-]\d{4}|\d{4}-\d{2}-\d{2})/giu],
    ['ID', /(?<![\p{L}_])(?:passport(?: no| number)?|id(?: number| no)|national id|driver'?s licen[cs]e)\s*["']?\s*[:=]?\s*["']?([A-Z]{0,2}\d{6,11}[A-Z]?)(?![\d\p{L}])/giu],
    ['IP', /(?<!version\s)(?<!\bv)\b(?!(?:10|127|0)\.)(?!192\.168\.)(?!172\.(?:1[6-9]|2\d|3[01])\.)(?!169\.254\.)(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g],
    ['NAME', /(?<!\p{L})(?:[Mm]y name is|I am|I'm|[Dd]ear|[Rr]egards|[Ss]incerely|[Bb]est regards|[Kk]ind regards|[Cc]heers)\s*,?\s+(\p{Lu}\p{Ll}+(?:\s+\p{Lu}\p{Ll}+){1,2})/gu],
    ['NAME', /(?<!\p{L})(?:Mr|Mrs|Ms|Miss|Dr|Prof)\.?\s+(\p{Lu}\p{Ll}+(?:\s+\p{Lu}\p{Ll}+){0,2})/gu],
    ['NAME', /(?<![\p{L}_])(?:first[ _-]?name|last[ _-]?name|given[ _-]?name|family[ _-]?name|surname)\s*["']?\s*[:=]\s*["']?([^\n,;"']{2,60}?)\s*(?=[\n,;"']|$)/giu, personLike],
    ['NAME', /(?<![\p{L}_])(?:full[ _-]?name|customer(?:[ _-]?name)?|contact(?:[ _-]?name)?|owner|patient|employee|name)\s*["']?\s*[:=]\s*["']?([^\n,;"']{2,60}?)\s*(?=[\n,;"']|$)/giu, fullNameLike]
  ];
  const nameForms = t => {
    const l = [...t.toLowerCase()];
    const upper = l.map(ch => ch.toUpperCase()).join('');
    const cap = l.map((ch, i) => i ? ch : ch.toUpperCase()).join('');
    return `(?:${cap}|${upper})`;
  };
  const TYPES = [...new Set(PATTERNS.map(p => p[0]))];
  const config = { disable: new Set(), extra: [], allow: new Set(), allowOpaqueUploads: false, allowUnknownUploads: false };
  const configure = cfg => {
    config.disable = new Set((cfg && cfg.disable || []).map(t => String(t).toUpperCase()));
    config.allow = new Set(cfg && cfg.allow || []);
    config.allowOpaqueUploads = !!(cfg && cfg.allowOpaqueUploads);
    config.allowUnknownUploads = !!(cfg && cfg.allowUnknownUploads);
    config.extra = (cfg && cfg.extra || []).map(e => [String(e.type || 'CUSTOM').toUpperCase().replace(/[^A-Z]/g, '') || 'CUSTOM', new RegExp(e.pattern, 'g' + (e.flags || '').replace(/g/g, ''))]);
    return config;
  };
  const PLACEHOLDER = /__PII_[A-Z_]+_(?:[0-9a-f]{12}|[0-9a-f]{6})__/g;
  const hasPlaceholder = s => /__PII_[A-Z_]+_(?:[0-9a-f]{12}|[0-9a-f]{6})__/.test(s);

  const emailPrefix = candidate => {
    const start = candidate.indexOf('@') + 1;
    const labels = candidate.slice(start).split('.');
    if (!/^[A-Za-z0-9-]+$/.test(labels[0])) return '';
    let offset = start + labels[0].length;
    let end = 0;
    for (const label of labels.slice(1)) {
      offset++;
      const tld = /^[A-Za-z]{2,}/.exec(label);
      if (tld) end = offset + tld[0].length;
      if (!/^[A-Za-z0-9-]+$/.test(label)) break;
      offset += label.length;
    }
    return candidate.slice(0, end);
  };

  const adjacentEmail = /[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}/y;
  const replaceEmails = (text, re, replace) => {
    const parts = [];
    let offset = 0;
    let match;
    re.lastIndex = 0;
    while ((match = re.exec(text))) {
      while (match) {
        parts.push(text.slice(offset, match.index), replace(...match, match.index, text));
        offset = match.index + match[0].length;
        let next = offset;
        while (text[next] === '-' || text[next] === '_') next++;
        adjacentEmail.lastIndex = next;
        match = adjacentEmail.exec(text);
      }
      re.lastIndex = offset;
    }
    parts.push(text.slice(offset));
    return parts.join('');
  };

  const apply = (text, type, re, check, found, tokenize) => {
    const replace = (...args) => {
      const m = type === 'EMAIL' ? emailPrefix(args[0]) : args[0];
      if (!m) return args[0];
      const val = typeof args[1] === 'string' ? args[1] : m;
      if (check && !check(val)) return args[0];
      if (config.allow.has(val)) return args[0];
      const p = `__PII_${type}_${tokenize(val)}__`;
      found[p] = val;
      return args[0].replace(val, p);
    };
    return re === PATTERNS[0][1] ? replaceEmails(text, re, replace) : text.replace(re, replace);
  };

  const namesFromEmails = (found, text) => Object.entries(found)
    .filter(([p]) => p.startsWith('__PII_EMAIL_'))
    .map(([, v]) => v.split('@')[0].split(/[._-]/).map(t => t.replace(/\d+$/, '')).filter(t => /^[a-z]{3,}$/i.test(t)))
    .filter(parts => parts.length >= 2)
    .map(parts => parts.map(t => new RegExp('(?<!\\p{L})' + nameForms(t) + '(?!\\p{L})', 'gu')))
    .filter(res => res.every(re => re.test(text)))
    .flat();

  const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const NAME_STOPLIST = new Set('will may mark grace bill chase penny amber crystal summer autumn'.split(' '));
  const repeatedNames = found => Object.entries(found)
    .filter(([p]) => p.startsWith('__PII_NAME_'))
    .flatMap(([, name]) => {
      const words = name.trim().split(/\s+/);
      if (words.length >= 2) return [...new Set([name, name.toLowerCase(), name.toUpperCase(), name.toLowerCase().replace(/(^|[ \t])\p{L}/gu, s => s.toUpperCase())])];
      if (NAME_STOPLIST.has(name.toLowerCase())) return [];
      return [name];
    })
    .sort((a, b) => b.length - a.length)
    .map(name => new RegExp('(?<![\\p{L}\\p{N}_])' + escape(name) + '(?![\\p{L}\\p{N}_])', 'gu'));

  const mask = (text, found, tokenize = defaultTokenizer) => {
    for (const [type, re, check] of [...PATTERNS, ...config.extra]) if (!config.disable.has(type)) text = apply(text, type, re, check, found, tokenize);
    if (!config.disable.has('NAME')) for (const re of namesFromEmails(found, text)) text = apply(text, 'NAME', re, null, found, tokenize);
    if (!config.disable.has('NAME')) for (const re of repeatedNames(found)) text = apply(text, 'NAME', re, null, found, tokenize);
    return text;
  };
  const unmask = (text, map) => {
    for (let i = 0; i < 10; i++) {
      const next = text.replace(PLACEHOLDER, p => map[p] ?? p);
      if (next === text) return text;
      text = next;
    }
    return text;
  };
  const deepMap = (v, fn) => typeof v === 'string' ? fn(v)
    : Array.isArray(v) ? v.map(x => deepMap(x, fn))
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deepMap(x, fn)]))
    : v;

  return { createTokenizer, mask, unmask, luhn, iban, chineseId, hasPlaceholder, deepMap, PLACEHOLDER, TYPES, configure };
});

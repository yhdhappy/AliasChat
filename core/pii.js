(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.pii = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const hash = s => {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < s.length; i++) {
      const ch = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return ((h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0')).slice(0, 12);
  };

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
    ['EMAIL', /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g],
    ['IBAN', /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g, iban],
    ['PHONE_CN', /\b1[3-9]\d{9}\b/g],
    ['ID_CN', /\b[1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/g, chineseId],
    ['CARD_CN', /\b62\d{14,17}\b/g, luhn],
    ['CARD', /\b[2-6]\d{14,15}\b|\b[2-6]\d{3}(?:[ -]\d{4}){3}\b|\b[2-6]\d{3}[ -]\d{6}[ -]\d{5}\b/g, luhn],
    ['SSN', /\b\d{3}-\d{2}-\d{4}\b/g],
    ['PHONE', /(?:\+|\b00)\d{1,3}[ .-]?\(?\d{1,4}\)?(?:[ .-]?\d{2,4}){2,4}\b|\(\d{3}\)[ .-]?\d{3}[ .-]?\d{4}\b|\b\d{3}[.-]\d{3}[.-]\d{4}\b|\b0\d{4} ?\d{6}\b/g],
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
  const config = { disable: new Set(), extra: [], allow: new Set() };
  const configure = cfg => {
    config.disable = new Set((cfg && cfg.disable || []).map(t => String(t).toUpperCase()));
    config.allow = new Set(cfg && cfg.allow || []);
    config.extra = (cfg && cfg.extra || []).map(e => [String(e.type || 'CUSTOM').toUpperCase().replace(/[^A-Z]/g, '') || 'CUSTOM', new RegExp(e.pattern, 'g' + (e.flags || '').replace(/g/g, ''))]);
    return config;
  };
  const PLACEHOLDER = /__PII_[A-Z_]+_(?:[0-9a-f]{12}|[0-9a-f]{6})__/g;
  const hasPlaceholder = s => /__PII_[A-Z_]+_(?:[0-9a-f]{12}|[0-9a-f]{6})__/.test(s);

  const apply = (text, type, re, check, found, salt) => text.replace(re, (...args) => {
    const m = args[0];
    const val = typeof args[1] === 'string' ? args[1] : m;
    if (check && !check(val)) return m;
    if (config.allow.has(val)) return m;
    const p = `__PII_${type}_${hash(salt ? salt + '\0' + val : val)}__`;
    found[p] = val;
    return m.replace(val, p);
  });

  const namesFromEmails = (found, text) => Object.entries(found)
    .filter(([p]) => p.startsWith('__PII_EMAIL_'))
    .map(([, v]) => v.split('@')[0].split(/[._-]/).map(t => t.replace(/\d+$/, '')).filter(t => /^[a-z]{3,}$/i.test(t)))
    .filter(parts => parts.length >= 2)
    .map(parts => parts.map(t => new RegExp('(?<!\\p{L})' + nameForms(t) + '(?!\\p{L})', 'gu')))
    .filter(res => res.every(re => re.test(text)))
    .flat();

  const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const repeatedNames = found => Object.entries(found)
    .filter(([p]) => p.startsWith('__PII_NAME_'))
    .flatMap(([, name]) => [...new Set([name, name.toLowerCase(), name.toUpperCase(), name.toLowerCase().replace(/(^|[ \t])\p{L}/gu, s => s.toUpperCase())])])
    .sort((a, b) => b.length - a.length)
    .map(name => new RegExp('(?<![\\p{L}\\p{N}_])' + escape(name) + '(?![\\p{L}\\p{N}_])', 'gu'));

  const mask = (text, found, salt = '') => {
    for (const [type, re, check] of [...PATTERNS, ...config.extra]) if (!config.disable.has(type)) text = apply(text, type, re, check, found, salt);
    if (!config.disable.has('NAME')) for (const re of namesFromEmails(found, text)) text = apply(text, 'NAME', re, null, found, salt);
    if (!config.disable.has('NAME')) for (const re of repeatedNames(found)) text = apply(text, 'NAME', re, null, found, salt);
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

  return { mask, unmask, luhn, iban, chineseId, hasPlaceholder, deepMap, PLACEHOLDER, TYPES, configure };
});
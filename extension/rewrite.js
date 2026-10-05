(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.piiRewrite = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const TEXT_KEYS = new Set(['prompt', 'parts', 'extracted_content', 'text', 'content', 'message_content', 'file_name']);
  const isChatRequest = url => /\/(completion|conversation|chat_conversations)(\/.*)?$/.test(url.split(/[?#]/)[0]);
  const isUploadMetadataRequest = url => /^(?:https:\/\/(?:chatgpt\.com|chat\.openai\.com))?\/backend-api\/files\/?$/.test(url.split(/[?#]/)[0]);
  const walk = (v, key, mask, found, attachment = false) => typeof v === 'string' ? (TEXT_KEYS.has(key) ? mask(v, found) : v)
    : Array.isArray(v) ? v.map(x => walk(x, key, mask, found, key === 'attachments'))
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, attachment && k === 'name' ? 'file_name' : k, mask, found)]))
    : v;
  const rewriteJson = (text, mask, found) => JSON.stringify(walk(JSON.parse(text), '', mask, found));
  const rewriteForm = (text, mask, found) => {
    const params = new URLSearchParams(text);
    for (const [k, v] of [...params.entries()]) {
      if (TEXT_KEYS.has(k)) params.set(k, mask(v, found));
      else if (/^[[{]/.test(v)) {
        let parsed;
        try { parsed = JSON.parse(v); } catch { continue; }
        params.set(k, JSON.stringify(walk(parsed, '', mask, found)));
      }
    }
    return params.toString();
  };
  const rewrite = (bodyText, mask, found) => /^\s*[[{]/.test(bodyText) ? rewriteJson(bodyText, mask, found) : rewriteForm(bodyText, mask, found);
  return { isChatRequest, isUploadMetadataRequest, rewrite };
});
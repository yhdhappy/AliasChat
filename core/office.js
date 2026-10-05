(function (root, factory) {
  const api = typeof module === 'object' && module.exports ? factory(require('./zip.js')) : factory(root.mask2aiZip);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.mask2aiOffice = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (zip) {
  const td = new TextDecoder();
  const te = new TextEncoder();
  const TEXT_PARTS = /^(word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml|xl\/sharedStrings\.xml|ppt\/(slides|notesSlides)\/[^/]+\.xml)$/;
  const PROPERTIES = /^docProps\/(core|app)\.xml$/;
  const PROPERTY_TEXT = /(<([\w:.-]+)(?:\s[^>]*)?>)([^<]*)(<\/\2>)/g;
  const XML_TEXT = /(<(?:w:t|t|a:t)(?:\s[^>]*)?>)([^<]*)(<\/(?:w:t|t|a:t)>)/g;
  const decode = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const encode = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const kind = name => /\.docx$/i.test(name) ? 'docx' : /\.xlsx$/i.test(name) ? 'xlsx' : /\.pptx$/i.test(name) ? 'pptx' : null;
  const mask = async (bytes, maskText, found) => {
    const entries = await zip.read(bytes);
    let changed = false;
    for (const e of entries) {
      if (!TEXT_PARTS.test(e.name) && !PROPERTIES.test(e.name)) continue;
      const xml = td.decode(e.data);
      const replaceText = (m, open, text, close, author = false) => {
        const value = decode(text);
        const masked = author ? maskText('Name: ' + value, found).slice(6) : maskText(value, found);
        return masked === value ? m : open + encode(masked) + close;
      };
      const out = PROPERTIES.test(e.name)
        ? xml.replace(PROPERTY_TEXT, (m, open, tag, text, close) => replaceText(m, open, text, close, /^(dc:creator|cp:lastModifiedBy)$/.test(tag)))
        : xml.replace(XML_TEXT, (m, open, text, close) => replaceText(m, open, text, close));
      if (out !== xml) {
        e.data = te.encode(out);
        changed = true;
      }
    }
    return changed ? zip.write(entries) : bytes;
  };
  return { kind, mask };
});
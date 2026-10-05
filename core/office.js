(function (root, factory) {
  const api = typeof module === 'object' && module.exports ? factory(require('./zip.js')) : factory(root.mask2aiZip);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.mask2aiOffice = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (zip) {
  const td = new TextDecoder();
  const te = new TextEncoder();
  const TEXT_PARTS = /^(word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml|xl\/sharedStrings\.xml|ppt\/(slides|notesSlides)\/[^/]+\.xml)$/;
  const PROPERTIES = /^docProps\/(core|app)\.xml$/;
  const WORKSHEETS = /^xl\/worksheets\/sheet\d+\.xml$/;
  const XML_CELL = /(<c\b(?![^>]*\/>)[^>]*>)([\s\S]*?)(<\/c>)/g;
  const XML_NUMBER = /<v>(\d+)<\/v>/g;
  const XML_VALUE = /(<v(?:\s[^>]*)?>)([^<]*)(<\/v>)/g;
  const PROPERTY_TEXT = /(<([\w:.-]+)(?:\s[^>]*)?>)([^<]*)(<\/\2>)/g;
  const XML_TEXT = /(<(?:w:t|w:delText|w:instrText|t|a:t)(?:\s[^>]*)?>)([^<]*)(<\/(?:w:t|w:delText|w:instrText|t|a:t)>)/g;
  const decode = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const encode = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const kind = name => /\.docx$/i.test(name) ? 'docx' : /\.xlsx$/i.test(name) ? 'xlsx' : /\.pptx$/i.test(name) ? 'pptx' : null;
  const mask = async (bytes, maskText, found) => {
    const entries = await zip.read(bytes);
    let changed = false;
    for (const e of entries) {
      if (!TEXT_PARTS.test(e.name) && !PROPERTIES.test(e.name) && !WORKSHEETS.test(e.name)) continue;
      const xml = td.decode(e.data);
      const replaceText = (m, open, text, close, author = false) => {
        const value = decode(text);
        const masked = author ? maskText('Name: ' + value, found).slice(6) : maskText(value, found);
        return masked === value ? m : open + encode(masked) + close;
      };
      let out = PROPERTIES.test(e.name)
        ? xml.replace(PROPERTY_TEXT, (m, open, tag, text, close) => replaceText(m, open, text, close, /^(dc:creator|cp:lastModifiedBy)$/.test(tag)))
        : WORKSHEETS.test(e.name) ? xml : xml.replace(XML_TEXT, (m, open, text, close) => replaceText(m, open, text, close));
      if (WORKSHEETS.test(e.name)) {
        out = out.replace(XML_CELL, (cell, open, content, close) => {
          if (/<f\b/.test(content)) {
            const masked = content.replace(XML_VALUE, (m, open, text, close) => replaceText(m, open, text, close));
            if (masked === content) return cell;
            const type = open.match(/\bt\s*=\s*(["'])(.*?)\1/);
            const textOpen = type ? open.replace(type[0], 't="str"') : open.slice(0, -1) + ' t="str">';
            return textOpen + masked + close;
          }
          content = content.replace(XML_TEXT, (m, open, text, close) => replaceText(m, open, text, close));
          const type = open.match(/\bt\s*=\s*(["'])(.*?)\1/);
          if (type && type[2] !== 'n') return open + content + close;
          const masked = content.replace(XML_NUMBER, (value, number) => {
            const text = maskText(number, found);
            return text === number ? value : '<is><t>' + encode(text) + '</t></is>';
          });
          if (masked === content) return open + content + close;
          const textOpen = type ? open.replace(type[0], 't="inlineStr"') : open.slice(0, -1) + ' t="inlineStr">';
          return textOpen + masked + close;
        });
      }
      if (out !== xml) {
        e.data = te.encode(out);
        changed = true;
      }
    }
    return changed ? zip.write(entries) : bytes;
  };
  return { kind, mask };
});

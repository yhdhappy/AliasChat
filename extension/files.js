(function (root, factory) {
  const api = typeof module === 'object' && module.exports ? factory(require('../core/office.js')) : factory(root.mask2aiOffice);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.mask2aiFiles = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (office) {
  const TEXT = /\.(txt|md|markdown|csv|tsv|json|xml|html?|ya?ml|log|rtf|js|ts|py|java|sql)$/i;
  const OPAQUE = /\.(pdf|png|jpe?g|gif|webp|heic|bmp|tiff?)$/i;
  const classify = name => office.kind(name) ? 'office' : TEXT.test(name) ? 'text' : OPAQUE.test(name) ? 'opaque' : 'other';
  const maskFileName = (name, maskText, found) => {
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const extension = dot > 0 ? name.slice(dot) : '';
    const named = stem.replace(/(?<![\p{L}])\p{Lu}\p{Ll}+(?:[ _-]+\p{Lu}\p{Ll}+){1,3}(?![\p{L}])/gu, value => {
      const normalized = value.replace(/[_-]/g, ' ');
      const masked = maskText('Name: ' + normalized, found).slice(6);
      return masked === normalized ? value : masked;
    });
    return maskText(named, found) + extension;
  };
  const maskFile = async (file, maskText, found, warn = () => {}, config = {}) => {
    const kind = classify(file.name);
    let content = file;
    if (kind === 'opaque' || kind === 'other') {
      const allowed = kind === 'opaque' ? config.allowOpaqueUploads : config.allowUnknownUploads;
      if (!allowed) throw Object.assign(new Error(kind === 'opaque' ? 'PDF/image upload blocked' : 'Unsupported file upload blocked'), { code: kind === 'opaque' ? 'opaque-blocked' : 'unknown-blocked' });
      warn(file.name + ' was uploaded uninspected; this file type cannot be masked in the browser');
    } else if (kind === 'text') {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let encoding = 'utf-8';
      let bom = 0;
      if (bytes[0] === 0xff && bytes[1] === 0xfe) { encoding = 'utf-16le'; bom = 2; }
      else if (bytes[0] === 0xfe && bytes[1] === 0xff) { encoding = 'utf-16be'; bom = 2; }
      else if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) bom = 3;
      let text;
      try {
        text = new TextDecoder(encoding, { fatal: true }).decode(bytes.subarray(bom));
        if (text.includes('\u0000')) throw new Error('Unsupported text encoding');
      } catch {
        warn(file.name + ' was uploaded uninspected; its text encoding could not be decoded safely');
        return new File([file], maskFileName(file.name, maskText, found), { type: file.type, lastModified: file.lastModified });
      }
      const masked = maskText(text, found);
      if (encoding === 'utf-8') content = new Blob([bytes.subarray(0, bom), new TextEncoder().encode(masked)]);
      else {
        const out = new Uint8Array(2 + masked.length * 2);
        out.set(bytes.subarray(0, 2));
        const view = new DataView(out.buffer);
        for (let i = 0; i < masked.length; i++) view.setUint16(2 + i * 2, masked.charCodeAt(i), encoding === 'utf-16le');
        content = new Blob([out]);
      }
    } else if (kind === 'office') {
      const bytes = new Uint8Array(await file.arrayBuffer());
      content = await office.mask(bytes, maskText, found);
    }
    const name = maskFileName(file.name, maskText, found);
    return content === file && name === file.name ? file : new File([content], name, { type: file.type, lastModified: file.lastModified });
  };
  const maskFormData = async (form, maskText, found, warn = () => {}, config = {}) => {
    const out = new FormData();
    for (const [key, value] of form.entries()) {
      if (value instanceof File) {
        const masked = await maskFile(value, maskText, found, warn, config);
        out.append(key, masked, masked.name);
      } else out.append(key, value);
    }
    return out;
  };
  return { classify, maskFileName, maskFile, maskFormData };
});

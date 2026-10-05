(() => {
  chrome.runtime.onInstalled.addListener(details => {
    chrome.storage.session.clear();
    maskingKey = undefined;
    if (details.reason === 'install') {
      chrome.tabs.create({ url: chrome.runtime.getURL('extension/welcome.html') });
    }
  });
})();

let maskingKey;
const getMaskingKey = () => maskingKey ||= (async () => {
  let { privyKey } = await chrome.storage.session.get('privyKey');
  if (!Array.isArray(privyKey) || privyKey.length !== 32) {
    privyKey = [...crypto.getRandomValues(new Uint8Array(32))];
    await chrome.storage.session.set({ privyKey });
  }
  return crypto.subtle.importKey('raw', new Uint8Array(privyKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
})().catch(error => {
  maskingKey = undefined;
  throw error;
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  (async () => {
    if (message?.type === 'privy-map-get') {
      respond({ privyMap: (await chrome.storage.session.get('privyMap')).privyMap || {} });
      return;
    }
    if (message?.type === 'privy-map-set') {
      if (!message.privyMap || typeof message.privyMap !== 'object' || Array.isArray(message.privyMap)) throw new Error('Invalid placeholder map');
      await chrome.storage.session.set({ privyMap: message.privyMap });
      respond({ ok: true });
      return;
    }
    if (message?.type !== 'privy-digests' || !Array.isArray(message.values) || !message.values.every(value => typeof value === 'string')) throw new Error('Invalid masking values');
    const key = await getMaskingKey();
    const digests = await Promise.all(message.values.map(async value => {
      const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
      return [...bytes.slice(0, 6)].map(n => n.toString(16).padStart(2, '0')).join('');
    }));
    respond({ digests });
  })().catch(() => respond({ error: 'Could not process private data' }));
  return true;
});

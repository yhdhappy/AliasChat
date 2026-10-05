(() => {
  chrome.runtime.onInstalled.addListener(async details => {
    await chrome.storage.session.remove('privyKey');
    maskingKey = undefined;
    if (details.reason === 'install') {
      chrome.tabs.create({ url: chrome.runtime.getURL('extension/welcome.html') });
    }
  });
})();

let maskingKey;
const MAX_MAP_ENTRIES = 20000;
let mapQueue = Promise.resolve();
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
  const process = async () => {
    if (message?.type === 'privy-map-get') {
      const stored = await chrome.storage.session.get(['aliasMap', 'privyMap']);
      const legacyMap = stored.privyMap && typeof stored.privyMap === 'object' && !Array.isArray(stored.privyMap) ? stored.privyMap : {};
      const currentMap = stored.aliasMap && typeof stored.aliasMap === 'object' && !Array.isArray(stored.aliasMap) ? stored.aliasMap : {};
      const aliasMap = { ...legacyMap, ...currentMap };
      if (Object.entries(legacyMap).some(([key, value]) => currentMap[key] !== value)) await chrome.storage.session.set({ aliasMap });
      respond({ privyMap: aliasMap });
      return;
    }
    if (message?.type === 'privy-map-set') {
      if (!message.privyMap || typeof message.privyMap !== 'object' || Array.isArray(message.privyMap)) throw new Error('Invalid placeholder map');
      const { aliasMap: current } = await chrome.storage.session.get('aliasMap');
      const aliasMap = { ...current, ...message.privyMap };
      const count = Object.keys(aliasMap).length;
      if (count > MAX_MAP_ENTRIES) {
        respond({ error: `AliasChat placeholder map is full (${count} entries). Restart the browser to clear it (the map lives in session storage).` });
        return;
      }
      await chrome.storage.session.set({ aliasMap });
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
  };
  const result = message?.type === 'privy-map-get' || message?.type === 'privy-map-set' ? mapQueue.then(process) : process();
  if (message?.type === 'privy-map-get' || message?.type === 'privy-map-set') mapQueue = result.catch(() => {});
  result.catch(() => respond({ error: 'Could not process private data' }));
  return true;
});

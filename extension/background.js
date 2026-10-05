chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });

chrome.runtime.onStartup.addListener(() => {
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });
});

(() => {
  chrome.runtime.onInstalled.addListener(details => {
    chrome.storage.session.clear();
    if (details.reason === 'install') {
      chrome.tabs.create({ url: chrome.runtime.getURL('extension/welcome.html') });
    }
  });
})();

let maskingKey;
const getMaskingKey = () => maskingKey ||= (async () => {
  let { privyKey } = await chrome.storage.session.get('privyKey');
  if (!privyKey) {
    privyKey = [...crypto.getRandomValues(new Uint8Array(32))];
    await chrome.storage.session.set({ privyKey });
  }
  return crypto.subtle.importKey('raw', new Uint8Array(privyKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
})();
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.type !== 'privy-digests') return;
  (async () => {
    if (!Array.isArray(message.values) || !message.values.every(value => typeof value === 'string')) throw new Error('Invalid masking values');
    const key = await getMaskingKey();
    const digests = await Promise.all(message.values.map(async value => {
      const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
      return [...bytes.slice(0, 6)].map(n => n.toString(16).padStart(2, '0')).join('');
    }));
    respond({ digests });
  })().catch(() => respond({ error: 'Could not generate private placeholders' }));
  return true;
});

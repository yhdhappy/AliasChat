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

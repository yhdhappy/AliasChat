(() => {
  chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.session.clear();
  });
})();

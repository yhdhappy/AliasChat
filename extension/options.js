const area = document.getElementById('config');
const status = document.getElementById('status');
chrome.storage.sync.get('config', ({ config }) => { if (config && Object.keys(config).length) area.value = JSON.stringify(config, null, 2); });
document.getElementById('save').addEventListener('click', async () => {
  let config = {};
  try {
    config = area.value.trim() ? JSON.parse(area.value) : {};
    status.textContent = 'Checking custom patterns…';
    await mask2aiRegex.validateExtras(config);
  } catch (e) {
    status.textContent = 'Not saved: ' + e.message;
    return;
  }
  chrome.storage.sync.set({ config }, () => { status.textContent = 'Saved. Reload the claude.ai or ChatGPT tab.'; });
});
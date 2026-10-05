const area = document.getElementById('config');
const status = document.getElementById('status');
const opaqueBox = document.getElementById('allowOpaqueUploads');
const unknownBox = document.getElementById('allowUnknownUploads');
chrome.storage.sync.get('config', ({ config }) => {
  const cfg = config || {};
  if (Object.keys(cfg).length) area.value = JSON.stringify(cfg, null, 2);
  opaqueBox.checked = !!cfg.allowOpaqueUploads;
  unknownBox.checked = !!cfg.allowUnknownUploads;
});
document.getElementById('save').addEventListener('click', async () => {
  let config;
  try {
    config = area.value.trim() ? JSON.parse(area.value) : {};
  } catch (e) {
    status.textContent = 'Not saved: ' + e.message;
    return;
  }
  config.allowOpaqueUploads = opaqueBox.checked;
  config.allowUnknownUploads = unknownBox.checked;
  status.textContent = 'Checking custom patterns…';
  try {
    await mask2aiRegex.validateExtras(config);
  } catch (e) {
    status.textContent = 'Not saved: ' + e.message;
    return;
  }
  chrome.storage.sync.set({ config }, () => {
    area.value = JSON.stringify(config, null, 2);
    status.textContent = 'Saved. Reload the claude.ai or ChatGPT tab.';
  });
});

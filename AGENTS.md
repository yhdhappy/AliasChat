# Working on PrivyAI

Read `docs/HANDOFF.md` first; it has the architecture, the verification commands and the open work.

## Rules

- Verify before claiming: `npm test`. Do not list an environment or a file type the checks do not cover.
- No code comments unless unavoidable. No trailing whitespace.
- Commit messages: `type: Capitalised summary`, no attribution lines.
- Vanilla JS, no build step. Manifest V3.
- Keep `manifest.json` and `package.json` at the same version.
- After the extension is on the Chrome Web Store, write its item ID to `store/id.txt`.
- The placeholder map lives in `chrome.storage.session` (via `extension/bridge.js`), not in page memory.
- Page text restoration runs in the isolated world (`extension/bridge.js` MutationObserver). There is no `unmask-request` postMessage interface; webpages cannot request unmasking.

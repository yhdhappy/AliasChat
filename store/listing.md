# Chrome Web Store listing

## Name

PrivyAI

## Summary (132 characters max)

Masks names, emails, phone, card and ID numbers before your message reaches claude.ai or ChatGPT. Restores them on screen.

## Description

Data handling: PrivyAI processes your chat messages locally in your browser to find and mask personal data. No data is sent to any server. The placeholder map lives in session storage (in-memory, cleared when you close the browser) and cannot be accessed by web pages. Optional settings sync via your own browser account. No analytics or telemetry.

PrivyAI keeps personal data on your machine when you talk to an AI.

Before a message leaves claude.ai or chatgpt.com, the extension finds email addresses, phone numbers, payment cards, IBANs, national ID and social security numbers, dates of birth, names and street addresses in it and replaces each detected value with a placeholder. The reply comes back with the same placeholders and the page shows you the real values.

- Runs entirely in the page. No server, no account, no telemetry.
- A toast tells you how many values were masked each time you send.
- Card numbers are Luhn-checked and IBANs mod-97-checked, so timestamps and version numbers are left alone.
- Detectors target common English-language labels and formats.
- The placeholder map is stored in the browser's session storage (cleared when the browser closes) and is never sent anywhere.
- Open source, MIT: https://github.com/yhdhappy/privyAI

Not affiliated with OpenAI or Anthropic.

## Limitations

Detection is pattern based. It replaces the personal data it detects, but it cannot guarantee all personal data is caught. A bare name in free text with no title, label or matching email nearby is not detected. PDF and image uploads are blocked by default because their contents cannot be inspected in the browser (you can allow them in the options). Full list of what is and is not caught: https://github.com/yhdhappy/privyAI

## Single purpose

PrivyAI replaces personal data in messages sent to claude.ai and ChatGPT with placeholders, and restores the real values on screen.

## Category

Make Chrome Yours › Privacy & Security

## Language

English

## Permissions justification

The extension declares one permission, `storage`, to keep the optional configuration JSON from its options page. It uses content scripts on https://claude.ai/*, https://chatgpt.com/* and https://chat.openai.com/* only, which is the minimum needed to rewrite the chat request before it is sent and to restore placeholders in the rendered page. It makes no network requests of its own.

## Privacy practices (data usage form)

Google requires disclosure even when data is only processed locally, so tick these data types:

- Personally identifiable information (names, emails, phone, national ID numbers, addresses)
- Financial and payment information (card numbers, IBANs)
- Personal communications (the chat message being sent)
- Website content (the rendered chat page and uploaded files)

Justification for each: processed only inside the open tab to find and replace personal data; never transmitted, kept only in the extension's isolated memory for the life of the tab, or shared.

Tick all three certifications: not sold to third parties, not used for purposes unrelated to the single purpose, not used for creditworthiness or lending.

- No remote code. All scripts are packaged.
- Privacy policy URL: https://yhdhappy.github.io/privyAI/privacy.html (enable GitHub Pages from the docs/ folder first)

## Assets to upload

- Icon 128×128: `store/icon-128.png` (96px artwork with 16px transparent padding, as the store asks)
- Screenshots 1280×800: `store/shot-1-wire.png` (what ChatGPT received), `store/shot-2-restored.png` (what you see). Rendered from frames of `demo/chatgpt-web.gif`; regenerate when the recording changes
- Small promo tile 440×280: `store/promo-440x280.png` (logo and one placeholder example, no headline)

## Package

Run `scripts/pack-extension.sh`; upload `dist/privyAI-extension-<version>.zip`. The zip contains `manifest.json` plus every script and icon the manifest references, read from the manifest itself.

## After publishing

Put the 32-letter item ID from the store URL into `store/id.txt` (no newline) and commit. The marketing site build picks it up and shows the Chrome Web Store user and version badges on the home page.

## Steps

1. Register at https://chrome.google.com/webstore/devconsole (one-time developer fee).
2. New item, upload the zip.
3. Fill the store listing from this file, upload the icon and at least one screenshot. Homepage and support URL: https://github.com/yhdhappy/privyAI
4. Privacy tab: answer as above, set the privacy policy URL.
5. Account tab: verify the contact email and declare trader or non-trader status (EU).
6. Submit for review. First review usually takes a few days. Content scripts on three hosts and no permissions keep it in the fast lane.
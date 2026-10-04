#!/bin/sh
set -e
cd "$(dirname "$0")/.."
version=$(node -p "require('./manifest.json').version")
files=$(node -p "const m=require('./manifest.json');const o=m.options_ui?m.options_ui.page:null;const bg=m.background&&m.background.service_worker?[m.background.service_worker]:[];[...new Set([...m.content_scripts.flatMap(c=>c.js),...Object.values(m.icons),...bg,...(o?[o,o.replace(/\.html$/,'.js'),o.replace(/[^/]+$/,'regex-validation.js'),o.replace(/[^/]+$/,'regex-worker.js')]:[])])].join(' ')")
mkdir -p dist
out="dist/privyAI-extension-$version.zip"
rm -f "$out"
zip -q "$out" manifest.json $files extension/welcome.html extension/welcome.js
unzip -l "$out"
echo "$out"

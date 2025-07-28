#!/bin/bash
set -eo pipefail
set -x

cd "${BASH_SOURCE%/*}/../../.."
WEBHARE_CHECKEDOUT_TO="$(pwd)"

cd "$WEBHARE_CHECKEDOUT_TO/whtree"
npm install
cd "$WEBHARE_CHECKEDOUT_TO/addons/vscode-extension"

mkdir -p node_modules/@webhare
npm install --no-save
ln -sf "$WEBHARE_CHECKEDOUT_TO/whtree/jssdk/lsp-types" node_modules/@webhare/lsp-types

"$WEBHARE_CHECKEDOUT_TO/whtree/node_modules/.bin/tsc"
echo "No issues!"

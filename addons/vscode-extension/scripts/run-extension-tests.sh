#!/bin/bash
set -eo pipefail
set -x

cd "${BASH_SOURCE%/*}/../../.."
WEBHARE_CHECKEDOUT_TO="$(pwd)"

cd "$WEBHARE_CHECKEDOUT_TO/whtree"
# don't run eg. puppeteer download scripts
npm install --ignore-scripts
cd "$WEBHARE_CHECKEDOUT_TO/addons/vscode-extension"

mkdir -p node_modules/@webhare
npm install --no-save

# tried adding a relative link in package.json but that kept creating lsp-types folders inside the lsp-types folder
npm install --no-save @webhare/lsp-types@../../whtree/jssdk/lsp-types

"$WEBHARE_CHECKEDOUT_TO/whtree/node_modules/.bin/tsc"
echo "No issues!"

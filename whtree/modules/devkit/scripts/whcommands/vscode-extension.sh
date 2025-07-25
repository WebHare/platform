#!/bin/bash

# short: Manage the vscode extension

set -eo pipefail

exit_syntax() {
  echo "Syntax: wh vscode-extension [ install ]"
  echo "  install:   Install the WebHare VSCode extension into your local VSCode"
  exit 1
}

cd "$WEBHARE_CHECKEDOUT_TO/addons/vscode-extension" || die "The vscode-extension command requires a fully checked out WebHare source tree"

if [ "$1" == "install" ]; then
  if ! hash -r code  2>/dev/null ; then
    die "'code' not found in path. Is VSCode installed?"
  fi

  mkdir -p node_modules/@webhare
  npm install --no-save
  ln -sf "$WEBHARE_CHECKEDOUT_TO/whtree/jssdk/lsp-types" node_modules/@webhare/lsp-types

  PACKAGENAME="$(mktemp).vsix"
  "$WEBHARE_CHECKEDOUT_TO/whtree/node_modules/.bin/esbuild" --bundle --platform=node --external:vscode --outfile=dist/extension.js src/extension.ts
  node_modules/.bin/vsce package --no-dependencies -o "$PACKAGENAME"
  code --install-extension "$PACKAGENAME"
  rm "$PACKAGENAME"
  exit 0
fi

exit_syntax

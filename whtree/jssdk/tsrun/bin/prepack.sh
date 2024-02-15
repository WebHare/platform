#!/bin/bash
set -eo pipefail

cd "${BASH_SOURCE%/*}/.."
mkdir -p "dist"

if [ -z "$ESBUILD_BINARY" ]; then
  if [ -x "node_modules/.bin/esbuild" ]; then
    ESBUILD_BINARY="node_modules/.bin/esbuild"
  elif [ -x "../../node_modules/.bin/esbuild" ]; then
    ESBUILD_BINARY="../../node_modules/.bin/esbuild"
  fi
fi

if [ -z "$ESBUILD_BINARY" ]; then
  echo "esbuild not found. Please set ESBUILD_BINARY or npm install"
  exit 1
fi

"$ESBUILD_BINARY" \
    --bundle \
    --platform=node \
    --sourcemap \
    --external:esbuild \
    "src/index.ts" \
    > "dist/resolveplugin.js.tmp"

mv dist/resolveplugin.js{.tmp,}

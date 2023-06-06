#!/bin/bash

# short: (re)build the platform helpers

set -eo pipefail

die() {
  echo "$@"
  exit 1
}

PREFIX=()
VERBOSE=

while [[ $1 =~ ^-.* ]]; do
  if [ "$1" == "--verbose" ]; then
    PREFIX+=("time")
    VERBOSE=1
  else
    die "Illegal option $1"
    exit 1
  fi
  shift
done

WEBHARE_DIR="$(cd "${BASH_SOURCE%/*}/../../../.." || exit 1; pwd)"
[ -d "$WEBHARE_DIR" ] || die "Unable to find root directory"
( [ -f "$WEBHARE_DIR"/tsconfig.json ] && [ -f "$WEBHARE_DIR"/modules/system/js/internal/resolveplugin/index.ts ] ) || die "Root $WEBHARE_DIR does not appear to be a WebHare 5.2 source tree"

# Clear the esbuild cache so the new plugin has fresh data to work with
[ -d "$WEBHARE_COMPILECACHE" ] && rm -rf -- "$WEBHARE_COMPILECACHE/typescript"

## Create our runner plugin that lets node support typescript through esbuild
## ... but this module will have to be plain JS of course
# see https://esbuild.github.io/api/ for esbuild options
mkdir -p "$WEBHARE_DIR/modules/system/js/internal/generated/"

if [ "$VERBOSE" ]; then
  echo -n "Rebuilding platform helpers..."
fi
"${PREFIX[@]}" "$WEBHARE_DIR/node_modules/.bin/esbuild" \
    --bundle \
    --platform=node \
    --sourcemap \
    --external:esbuild \
    "$WEBHARE_DIR/modules/system/js/internal/resolveplugin/index.ts" \
    > "$WEBHARE_DIR/modules/system/js/internal/generated/resolveplugin.js.tmp"

mv "${WEBHARE_DIR}/modules/system/js/internal/generated/resolveplugin.js"{.tmp,}

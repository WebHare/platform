#!/bin/bash
# Use `wh finalize-webhare` to force a rebuild of the resolve plugign

set -eo pipefail
cd "${BASH_SOURCE%/*}/../../../.."

# Clear the esbuild cache so the new plugin has fresh data to work with
# This variable is only set if we're invoked with `wh finalize-webhare`
if [ -d "${WEBHARE_TSBUILDCACHE}" ] ; then
  echo "Clearing tsrun compile cache in ${WEBHARE_TSBUILDCACHE}"
  rm -rf -- "${WEBHARE_TSBUILDCACHE}"
fi

# Generate our own resolveplugin with our envvar support
TARGETDIR="jssdk/tsrun/dist" # doesn't seem correct to use this location, but eases the transition. maybe we should gather all generated core stuff into a whtree/dist/ folder"
mkdir -p "$TARGETDIR"

TARGETFILE="$TARGETDIR/resolveplugin.js"
node_modules/.bin/esbuild \
    --bundle \
    --platform=node \
    --sourcemap \
    --external:esbuild \
    "modules/platform/js/bootstrap/whnode.ts" \
    > "$TARGETFILE.tmp"

mv "$TARGETFILE.tmp" "$TARGETFILE"

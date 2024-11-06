#!/bin/bash

# finalize-webhare sets up all generated files in the source ($WEBHAREDIR) directory
# we will normally be invoked by `wh finalize-webhare`
#
# We need to be in shell script as TypeScript isn't available yet - we're bootstrapping TS support!

set -eo pipefail

RUNSHRINKWRAP=""

while [[ $1 =~ ^-.* ]]; do
  if [ "$1" == "--shrinkwrap" ]; then
    shift
    RUNSHRINKWRAP="1"
  else
    echo "Illegal option $1"
    exit 1
  fi
done

cd "${BASH_SOURCE%/*}/../../../.." || exit 1  #take us to whtree/
source "lib/wh-functions.sh"

[ -f package.json ] || die "Failed to navigate to whtree directory"

getwebhareversion
getwhparameters

# Install all packages
NPMCANDIDATES=$(ls -d . modules/* modules/*/webdesigns/* | grep -v webhare_testsuite)
for CANDIDATE in $NPMCANDIDATES ; do
  if [ -f "$CANDIDATE/package.json" ]; then
    npm install --no-save --ignore-scripts --omit=dev --omit=peer --prefix $CANDIDATE || die "NPM install failure for $CANDIDATE"
  fi
done

# run scripts we trust and need explicitly.
## download the esbuild for this platform
logWithTime "Downloading esbuild"
node node_modules/esbuild/install.js || die "Download failed"

## generate root tsconfig.json
node_modules/.bin/yaml --json --single --strict < tsconfig.yml | jq > tsconfig.json

## download sharp
(cd node_modules/sharp && npm run install)

## download puppeteer
(cd node_modules/puppeteer && npm run postinstall)

## get dependencies for the postgresql-client
logWithTime "Setup postgresql-client"
( cd jssdk/whdb/vendor/postgresql-client && npm install --no-save --ignore-scripts --omit=dev --omit=peer ) || die "postgresql-client install failure"

logWithTime "Build the resolveplugin"
modules/platform/scripts/bootstrap/build-resolveplugin.sh || die "Failed to setup the resolveplugin"

# When running from source, rebuild buildinfo (for docker builddocker.sh generates this, we may no longer have access to git information)
[ -z "$WEBHARE_IN_DOCKER" ] && generatebuildinfo

# HS precompile. This *must* be done before any attempt at running WASM engine HS code as they can't run without a live whcompile
echo "Precompiling HareScript"
rm -rf "$WEBHARE_COMPILECACHE/harescript/" # Mostly useful on dev machines so the direct__ check later doesn't fail you
(
  cd "$WEBHARE_DIR/modules" ;
  for P in *; do
    if [ "$P" != "webhare_testsuite" ]; then
      if ! wh compile -q "$P" ; then
        if [ -n "$WEBHARE_IGNORE_RUNNING" ]; then
          # wh -i finalize-webhare was used.. that'll always race against the running compiler so ignore build errors
          echo "Ignoring failed compile of $P"
        else
          echo "Compile of $P failed"
          exit 1
        fi
      fi
    fi
  done
)

# Ensure @mod- paths work
wh prepare-whdata

# Render platform/generated
wh update-generated-files --nodb

echo "Precompiling TypeScript"
rm -rf "$WEBHARE_COMPILECACHE/typescript/"
wh run "$WEBHARE_DIR/jssdk/tsrun/src/precompile.ts" "$WEBHARE_COMPILECACHE/typescript" "$WEBHARE_DIR"

echo "Compress country flags" #TODO brotli them! easiest to do this using node, as that one ships with brotli
gzip --keep --force "$WEBHARE_DIR/node_modules/flag-icons/flags/"*/*.svg

if [ -n "$RUNSHRINKWRAP" ]; then
  #TODO Merge with us?
  logWithTime "Shrinkwrap: create_shrinkwrap"
  modules/system/scripts/internal/create_shrinkwrap.sh || die "Unable to start create_shrinkwrap.sh"
fi

if ls "$WEBHARE_COMPILECACHE/harescript"/direct* >/dev/null 2>&1 ; then
  echo "Found direct files in the compile cache."
  ls "$WEBHARE_COMPILECACHE/harescript"/direct*
  exit 1
fi

logWithTime "Finalize done"
exit 0

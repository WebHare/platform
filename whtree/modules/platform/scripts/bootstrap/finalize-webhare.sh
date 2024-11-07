#!/bin/bash

# finalize-webhare sets up all generated files in the source ($WEBHAREDIR) directory
# we will normally be invoked by `wh finalize-webhare`
#
# We need to be in shell script as TypeScript isn't available yet - we're bootstrapping TS support!

set -eo pipefail

cd "${BASH_SOURCE%/*}/../../../.." || exit 1  #take us to whtree/
source "lib/wh-functions.sh"

[ -f package.json ] || die "Failed to navigate to whtree directory"

getwebhareversion
getwhparameters

logWithTime "Install all packages"
npm install --no-save --ignore-scripts --omit=dev --omit=peer || die "NPM install failure for $CANDIDATE"

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
rm -rf "$WEBHARE_COMPILECACHE/harescript/" # Mostly useful on dev machines so the direct__ check later doesn't fail you
(
  cd "$WEBHARE_DIR/modules" ;
  for MODULE in system platform wrd publisher tollium consilio socialite; do
    if [ "$MODULE" == "webhare_testsuite" ]; then
      continue
    fi

    logWithTime "Precompiling module $MODULE"
    if ! wh compile --quiet --onlyerrors "$MODULE" ; then
      if [ -n "$WEBHARE_IGNORE_RUNNING" ]; then
        # wh -i finalize-webhare was used.. that'll always race against the running compiler so ignore build errors
        echo "Ignoring failed compile of $MODULE"
      else
        echo "Compile of $MODULE failed"
        exit 1
      fi
    fi

    logWithTime "Creating history for module $MODULE" #TODO used for hotfix detection but can't we just go for a manifest based on modtimes and leave it at that ?
    mkdir -p "$MODULE/history"
    TZ=UTC zip --quiet --exclude "$MODULE/history/*" --exclude "platform/generated/*"  --recurse-paths "$MODULE/history/source.zip" "$MODULE"
  done
)

logWithTime "Prepare whdata, ensure @mod- paths work" # this result will be discarded but it's needed to bootstrap TS/HS code
wh prepare-whdata

logWithTime "Update generated files"
wh update-generated-files --nodb

logWithTime "Precompiling TypeScript"
rm -rf "$WEBHARE_COMPILECACHE/typescript/"
wh run "$WEBHARE_DIR/jssdk/tsrun/src/precompile.ts" "$WEBHARE_COMPILECACHE/typescript" "$WEBHARE_DIR"

logWithTime "Compress country flags" #TODO brotli them! easiest to do this using node, as that one ships with brotli
gzip --keep --force "$WEBHARE_DIR/node_modules/flag-icons/flags/"*/*.svg


logWithTime "Build plaform:* assetpacks"
rm -rf "$WEBHARE_DIR/modules/platform/generated/assetpacks"
wh publisher:compile "platform:*"

logWithTime "Final checks"
if ls "$WEBHARE_COMPILECACHE/harescript"/direct* >/dev/null 2>&1 ; then
  echo "Found direct files in the compile cache."
  ls "$WEBHARE_COMPILECACHE/harescript"/direct*
  exit 1
fi

logWithTime "Finalize done"
exit 0

#!/bin/bash

# finalize-webhare sets up all generated files in the source ($WEBHAREDIR) directory
# we will normally be invoked by `wh finalize-webhare`
#
# We need to be in shell script as TypeScript isn't available yet - we're bootstrapping TS suport!!

RUNSHRINKWRAP=""

while [[ $1 =~ ^-.* ]]; do
  if [ "$1" == "--shrinkwrap" ]; then
    shift
    RUNSHRINKWRAP="1"
  else
    echo "Illegal option $1"
    exit 1
  fi
  shift
done

cd "${BASH_SOURCE%/*}/../../../.." || exit 1  #take us to whtree/
source "modules/platform/scripts/bootstrap/bootstrap-functions.sh"

[ -f package.json ] || die "Failed ot navigate to whtree directory"

logWithTime "Updating whtree NPM packages"
npm install --no-save --ignore-scripts --omit=dev --omit=peer | die "NPM failure"

# run scripts we trust and need explicitly.
## download the esbuild for this platform
logWithTime "Downloading esbuild"
node node_modules/esbuild/install.js || die "Download failed"

## get dependencies for the postgresql-client
logWithTime "Setup postgresql-client"
( cd jssdk/whdb/vendor/postgresql-client && npm install --no-save --ignore-scripts --omit=dev --omit=peer ) || die "postgresql-client install failure"

logWithTime "Build the resolveplugin"
modules/platform/scripts/bootstrap/build-resolveplugin.sh || die "Failed to setup the resolveplugin"

if [ -n "$RUNSHRINKWRAP" ]; then
  #TODO Merge both with us?
  modules/system/scripts/internal/fixup_modules.sh || die "Unable to fixup the modules"
  exec modules/system/scripts/internal/create_shrinkwrap.sh || die "Unable to start create_shrinkwrap.sh"
fi

exit 0

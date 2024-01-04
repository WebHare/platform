#!/bin/bash

# finalize-webhare sets up all generated files in the source ($WEBHAREDIR) directory
# we will normally be invoked by `wh finalize-webhare`
#
# We need to be in shell script as TypeScript isn't available yet - we're bootstrapping TS support!

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
source "lib/wh-functions.sh"

[ -f package.json ] || die "Failed to navigate to whtree directory"

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

## download sharp
(cd node_modules/sharp && npm run install)

## get dependencies for the postgresql-client
logWithTime "Setup postgresql-client"
( cd jssdk/whdb/vendor/postgresql-client && npm install --no-save --ignore-scripts --omit=dev --omit=peer ) || die "postgresql-client install failure"

logWithTime "Build the resolveplugin"
modules/platform/scripts/bootstrap/build-resolveplugin.sh || die "Failed to setup the resolveplugin"

# When running from source, rebuild buildinfo (for docker builddocker.sh generates this)
if [ -z "$WEBHARE_IN_DOCKER" ]; then
  logWithTime "Build the resolveplugin"
  getwebhareversion # from make-functions.sh

  cat > "$WEBHARE_DIR/modules/system/whres/buildinfo.tmp" << HERE
committag="$(git -C "$WEBHARE_DIR" rev-parse HEAD)"
version="${WEBHARE_VERSION}-dev"
branch="$(git -C "$WEBHARE_DIR" rev-parse --abbrev-ref HEAD)"
origin=$(git -C "$WEBHARE_DIR" config --get remote.origin.url)
HERE
  mv "$WEBHARE_DIR/modules/system/whres/buildinfo.tmp" "$WEBHARE_DIR/modules/system/whres/buildinfo"
fi

if [ -n "$RUNSHRINKWRAP" ]; then
  #TODO Merge both with us?
  logWithTime "Shrinkwrap: fixup_modules"
  modules/system/scripts/internal/fixup_modules.sh || die "Unable to fixup the modules"
  logWithTime "Shrinkwrap: create_shrinkwrap"
  modules/system/scripts/internal/create_shrinkwrap.sh || die "Unable to start create_shrinkwrap.sh"
fi

logWithTime "Finalize done"
exit 0

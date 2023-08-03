#!/bin/bash

# We're launched in system/ for consistency by fixmodules, but we're actually responsible for all core modules. TODO we should probably be in platform/ now
cd "${BASH_SOURCE%/*}/../../.." || exit 1  #take us to whtree/

npm install --no-save --ignore-scripts --omit=peer

# run scripts we trust and need explicitly.
## download the esbuild for this platform
if ! node node_modules/esbuild/install.js ; then
  echo "Failed to setup esbuild"
  exit 1
fi

## get dependencies for the postgresql-client
# We may have to wait for the module to appear (docker does 2 fixmodules passes)
if [ -d "jssdk/whdb" ]; then
  if ! ( cd jssdk/whdb/vendor/postgresql-client && npm install --production ); then
    echo "Failed to setup postgresql-client"
    exit 1
  fi
fi

# Clear the esbuild cache so the new plugin has fresh data to work with
if [ -d "${WEBHARE_TSBUILDCACHE}" ] ; then
  echo "Clearing ts-esbuild-runner compile cache in ${WEBHARE_TSBUILDCACHE}"
  rm -rf -- "${WEBHARE_TSBUILDCACHE}"
fi

# Manually run the install script for @webhare/ts-esbuild-runner
# We may have to wait for the module to appear (docker does 2 fixmodules passes)
if [ -x "jssdk/ts-esbuild-runner/bin/prepack.sh" ]; then
  "jssdk/ts-esbuild-runner/bin/prepack.sh"
fi


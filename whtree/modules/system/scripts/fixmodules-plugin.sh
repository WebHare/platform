#!/bin/bash

# We're launched in system/ for consistency by fixmodules, but we're actually responsible for all core moduless

cd "${WEBHARE_DIR}" || exit 1
npm install --no-save --ignore-scripts --omit=peer

# run scripts we trust and need explicitly
node node_modules/esbuild/install.js

# Clear the esbuild cache so the new plugin has fresh data to work with
if [ -d "${WEBHARE_TSBUILDCACHE}" ] ; then
  echo "Clearing ts-esbuild-runner compile cache in ${WEBHARE_TSBUILDCACHE}"
  rm -rf -- "${WEBHARE_TSBUILDCACHE}"
fi

# Manually run the install script for @webhare/ts-esbuild-runner
# We may have to wait for the module to appear (docker does 2 fixmodules passes)
if [ -x "$WEBHARE_DIR/jssdk/ts-esbuild-runner/bin/prepack.sh" ]; then
  "$WEBHARE_DIR/jssdk/ts-esbuild-runner/bin/prepack.sh"
fi

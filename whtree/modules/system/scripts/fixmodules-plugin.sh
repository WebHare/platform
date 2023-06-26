#!/bin/bash

# We're launched in system/ for consistency by fixmodules, but we're actually responsible for all core moduless

cd "${WEBHARE_DIR}" || exit 1
npm install --no-save --ignore-scripts --omit=peer

# run scripts we trust and need explicitly
node node_modules/esbuild/install.js

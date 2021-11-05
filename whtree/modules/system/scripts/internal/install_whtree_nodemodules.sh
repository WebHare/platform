#!/bin/bash

# This script is used when building WebHare to fixup modules and do other post-build tasks, before create-shrinkwrap is invoked

# We are in whtree/modules/system/scripts/internal, we need to find whtree, so 4 up!
cd "${BASH_SOURCE%/*}/../../../.." || exit 1
npm install --no-save --ignore-scripts

# run scripts we trust and need explicitly
node node_modules/esbuild/install.js

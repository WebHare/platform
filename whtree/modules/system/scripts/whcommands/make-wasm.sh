#!/bin/bash

# NOTES: set WHBUILDNUMPROC=1 to reduce error noise

set -e -o pipefail -x
OPTIONS=("$@")

cd "${BASH_SOURCE%/*}/../.." || exit 1
# source "whtree/lib/wh-functions.sh"

export DEBUGMAKE=1
export BUILDSYSTEM=emscripten
export WEBHARE_BUILDDIR=/tmp/emscripten

setup_base_buildsystem
estimate_buildj

cd "$WEBHARE_BUILDDIR" || exit 1
make -r "-j$WHBUILD_NUMPROC" -f "$WEBHARE_CHECKEDOUT_TO/base_makefile" "${OPTIONS[@]}"

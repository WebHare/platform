#!/bin/bash
set -eo pipefail

if [ -z "$WHBUILD_EMSCRIPTEN_VERSION" ]; then
  echo "WHBUILD_EMSCRIPTEN_VERSION not set"
  exit 1;
fi
if [ -z "$WEBHARE_BUILDDIR" ]; then
  echo "WEBHARE_BUILDDIR not set"
  exit 1
fi

if [ "$WEBHARE_IN_CONTAINER" == "1" ]; then
  WHBUILD_EMSDK_ROOT="/opt/emsdk"
else
  WHBUILD_EMSDK_ROOT="$WEBHARE_BUILDDIR/emsdk"
fi

VERSIONFILE="$WHBUILD_EMSDK_ROOT/current-emscripten-version"

if [ "$WHBUILD_EMSCRIPTEN_VERSION" != "$(cat "$VERSIONFILE" 2> /dev/null || true)" ]; then
  # maybe toplevel should set a WHBUILD_VENDORDIR, poiting to BUILDDIR on Mac but /opt/ in containers

  if [ -d "$WHBUILD_EMSDK_ROOT/.git" ]; then
    git -C "$WHBUILD_EMSDK_ROOT" pull
  else
    git clone https://github.com/emscripten-core/emsdk.git "$WHBUILD_EMSDK_ROOT"
  fi

  cd "$WHBUILD_EMSDK_ROOT"

  "$WHBUILD_EMSDK_ROOT/emsdk" install "$WHBUILD_EMSCRIPTEN_VERSION"
  "$WHBUILD_EMSDK_ROOT/emsdk" activate "$WHBUILD_EMSCRIPTEN_VERSION"

  echo "$WHBUILD_EMSCRIPTEN_VERSION" > "$VERSIONFILE"
fi

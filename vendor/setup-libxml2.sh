#!/bin/bash

if [ -z "$WHBUILD_SRCDIR" ]; then
  echo WHBUILD_SRCDIR not set. Invoke us through wh make!
  exit 1;
fi

TARGETPLATFORM="$1"
TARGETDIR="$2"

if [ -z "$TARGETDIR" ] || [ -z "$TARGETPLATFORM" ]; then
  echo TARGETDIR not set. Invoke us through wh make!
  exit 1;
fi

if [ -f "${WHBUILD_SRCDIR}/vendor/libxml2/config.h" ]; then
  #oops, someone configured it already
  ( cd ${WHBUILD_SRCDIR}/vendor/libxml2 && make distclean )
fi

# Updating this file should trigger reconfiguration of libxml2
EXPECTCONFIGFILE="${TARGETDIR}/config.h"
echo Generating "$EXPECTCONFIGFILE" "(and libxml2/include/xmlversion.h)" for platform "$TARGETPLATFORM"
mkdir -p "${TARGETDIR}"
cd "${TARGETDIR}" || exit 1

rm -f -- "$EXPECTCONFIGFILE" # Ensure it's updated by autogen.sh or we may reloop on building libxml2
if [ "$(uname)" != "Darwin" ]; then
  export ACLOCAL_PATH=/usr/share/aclocal
fi

# Prevent parallel configure runs - setup-libxml2 can run twice but autogen writes to libxml2 $srcdir/m4 - and can overwrite its own work
if hash -r flock 2>/dev/null ; then
  FLOCK=flock
else
  FLOCK="$WHBUILD_SRCDIR/addons/flock.pl"
fi

# Cache configure results, shaves up to 60 sec of build times (because most of the build is blocked until both wasm and native versions are done)
CACHEFILE="$WHBUILD_BUILDCACHE_DIR/libxml2-$TARGETPLATFORM"
ARGS=(--cache-file "$CACHEFILE" --with-threads --without-http --without-catalog --without-iconv --without-debug --without-xinclude --without-zlib --without-lzma --without-python --without-icu)
echo Configure libxml2 with: "${ARGS[@]}"

if ! $FLOCK "$WHBUILD_SRCDIR/vendor/.setup-libxml2.lock" "${WHBUILD_SRCDIR}/vendor/libxml2/autogen.sh" "${ARGS[@]}" ;  then
  echo autogen/configure failed
  exit 1
fi

if [ ! -f "$EXPECTCONFIGFILE" ]; then
  echo Expected generated config file not present at "$EXPECTCONFIGFILE"
  exit 1
fi

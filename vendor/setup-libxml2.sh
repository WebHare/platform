#!/bin/bash

if [ -z "$WHBUILD_SRCDIR" ]; then
  echo WHBUILD_SRCDIR not set. Invoke us through wh make!
  exit 1;
fi
if [ -z "$WHBUILD_BUILDDIR" ]; then
  echo WHBUILD_BUILDDIR not set. Invoke us through wh make!
  exit 1;
fi

if [ -f "${WHBUILD_SRCDIR}/vendor/libxml2/config.h" ]; then
  #oops, someone configured it already
  ( cd ${WHBUILD_SRCDIR}/vendor/libxml2 && make distclean )
fi

# Updating this file should trigger reconfiguration of libxml2
EXPECTCONFIGFILE="${WHBUILD_BUILDDIR}/vendor/libxml2/config.h"
echo Generating "$EXPECTCONFIGFILE" "(and libxml2/include/xmlversion.h)"
mkdir -p "${WHBUILD_BUILDDIR}/vendor/libxml2"
cd "${WHBUILD_BUILDDIR}/vendor/libxml2" || exit 1

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

if ! $FLOCK "$WHBUILD_SRCDIR/vendor/.setup-libxml2.lock" "${WHBUILD_SRCDIR}/vendor/libxml2/autogen.sh" --with-threads --without-http --without-catalog --without-iconv --without-debug --without-xinclude --without-zlib --without-lzma --without-python --without-icu ;  then
  echo autogen/configure failed
  exit 1
fi

if [ ! -f "$EXPECTCONFIGFILE" ]; then
  echo Expected generated config file not present at "$EXPECTCONFIGFILE"
  exit 1
fi

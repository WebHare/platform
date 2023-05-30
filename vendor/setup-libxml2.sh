#!/bin/bash

# Updating this file should trigger reconfiguration of libxml2
cd "${BASH_SOURCE%/*}/libxml2" || exit 1
rm config.h # Ensure it's updated by autogen.sh or we may reloop on building libxml2
if [ "$(uname)" != "Darwin" ]; then
  export ACLOCAL_PATH=/usr/share/aclocal
fi

./autogen.sh --with-threads --without-http --without-catalog --without-iconv --without-debug --without-xinclude --without-zlib --without-lzma --without-python

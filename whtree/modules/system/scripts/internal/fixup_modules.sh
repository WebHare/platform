#!/bin/bash

# This script is used when building WebHare to fixup modules and do other post-build tasks, before create-shrinkwrap is invoked

# We are in whtree/modules/system/scripts/internal, we need to find whtree, so 4 up!
cd "${BASH_SOURCE%/*}/../../../.." || exit 1
WHTREE="$(pwd)"

FAIL=0

if [ -n "$WEBHARE_IN_DOCKER" ]; then #Only do this when building docker images, not for rpmbuild and not for manual 'wh make' builds
  export WEBHARE_BASEPORT=13679
  export WEBHARE_DTAPSTAGE=production
  export WEBHARE_SERVERNAME=fixup-modules.example.net

  "$WHTREE/modules/platform/scripts/bootstrap/prepare-whdata.sh" #Ensure @mod- paths work

  eval `$WHTREE/bin/wh setupmyshell`  #more dogfooding
  mkdir -p /opt/whdata/tmp/

  # Compile system module first, needed by wh fixmodules
  echo "Compiling the system module"
  $WHTREE/bin/wh exec whcompile -q /opt/wh/whtree/modules/system
  RETVAL=$?
  if [ $RETVAL != 0 ]; then
    echo "Compiling the system module failed with errorcode $RETVAL"
    FAIL=1
  fi

  echo "Compress country flags"
  gzip --keep /opt/wh/whtree/node_modules/flag-icons/flags/*/*.svg

  #Compile the rest parallel to fixmodules
  echo "Compiling the other core modules (background)"
  $WHTREE/bin/wh exec whcompile -q /opt/wh/whtree/modules/consilio /opt/wh/whtree/modules/publisher /opt/wh/whtree/modules/socialite /opt/wh/whtree/modules/tollium /opt/wh/whtree/modules/wrd &
  COMPILEPID=$!

  wait $COMPILEPID
  RETVAL=$?
  if [ $RETVAL != 0 ]; then
    echo "Compiling the core modules failed with errorcode $RETVAL"
    FAIL=1
  fi

  if ls /opt/wh/whtree/currentinstall/compilecache/direct* >/dev/null 2>&1 ; then
    echo "Found direct files in the compile cache."
    FAIL=1
  fi

  if [ "$(ls /opt/wh/whtree/currentinstall/compilecache/harescript/*.clib | wc -l)" -lt 1000 ]; then
    echo Too few entries in the compilecache, precompile may have failed
    FAIL=1
  fi
fi

exit $FAIL

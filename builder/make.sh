#!/bin/bash

set -eo pipefail

WEBHARE_CHECKEDOUT_TO="$(cd "${BASH_SOURCE%/*}/.."; pwd)"
source "$WEBHARE_CHECKEDOUT_TO/whtree/lib/make-functions.sh"
estimate_buildj

setup_builddir

export WEBHARE_BUILDDIR
export WHBUILD_DOWNLOADCACHE
export WHBUILD_BUILDROOT

if [ -n "$WEBHARE_IN_DOCKER" ] && [ -z "$WHBUILD_ALLOW" ]; then
  # Prevent you from accidentally breaking a running WebHare installation - did you think you were running this locally?
  die "If WEBHARE_IN_DOCKER is set you must set WHBUILD_ALLOW to be able to 'wh make'"
fi


export WHBUILD_CCACHE_DIR="$WHBUILD_BUILDROOT/ccache" #for ccache only
export WHBUILD_BUILDCACHE_DIR="$WHBUILD_BUILDROOT/buildcache" #for other build artifcates

mkdir -p "$WHBUILD_CCACHE_DIR" "$WHBUILD_BUILDCACHE_DIR"

cd "$WEBHARE_BUILDDIR"

# Colors are nice
export GCC_COLORS=1

export SRCDIR="$WEBHARE_CHECKEDOUT_TO"
export WEBHARE_PLATFORM

retval=0
make -rj$WHBUILD_NUMPROC -f $WEBHARE_CHECKEDOUT_TO/builder/base_makefile "$@" || retval=$?

if [ "$retval" != "0" ]; then
  echo ""
  echo "Make failed with errorcode $retval"
  echo ""

  [ -z "$WEBHARE_IN_DOCKER" ] && cat $WEBHARE_CHECKEDOUT_TO/builder/support/failhare.txt
  exit $retval
fi

exit 0

#!/bin/bash

set -eo pipefail

WEBHARE_CHECKEDOUT_TO="$(cd "${BASH_SOURCE%/*}/.."; pwd)"
source "$WEBHARE_CHECKEDOUT_TO/whtree/lib/make-functions.sh"
estimate_buildj

if [ "$WEBHARE_PLATFORM" == "linux" ]; then
  MAKE=/usr/local/bin/make #ensure we get make 4.4.1
  read -r _ TOTALMEM _ <<< "$(cat /proc/meminfo| grep ^MemTotal)"
  # With too little memory the buildtoolchains will randomly segfault, and defaults for Docker/podman can be smaller than that
  # 3994744 as this is what I got using: podman machine set -m 4096
  [ "$TOTALMEM" -lt 3994744 ] && die "You need at least 4GB of memory to build WebHare ($TOTALMEM < 3994744)"
else
  MAKE=gmake
fi

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
"$MAKE" -rj$WHBUILD_NUMPROC -f $WEBHARE_CHECKEDOUT_TO/builder/base_makefile "$@" || retval=$?

if [ "$retval" != "0" ]; then
  echo ""
  echo "Make failed with errorcode $retval"
  echo ""

  [ -z "$WEBHARE_IN_DOCKER" ] && cat $WEBHARE_CHECKEDOUT_TO/builder/support/failhare.txt
  exit $retval
fi

exit 0

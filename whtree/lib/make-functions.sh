#!/bin/bash
# This script is also deployed to https://build.webhare.dev/ci/scripts/make-functions.sh

# Helper functions shared between build ('make'), CI (testdocker) and runtime WebHare.

if [[ "$OSTYPE" == "darwin"* ]]; then
  WEBHARE_PLATFORM="darwin"
else
  WEBHARE_PLATFORM="linux"
fi

# We must have $WEBHARE_DIR, pointing to the 'whtree'.
if [ -z "$WEBHARE_DIR" ]; then
  if [ -n "$WEBHARE_CHECKEDOUT_TO" ]; then
    export WEBHARE_DIR="${WEBHARE_CHECKEDOUT_TO%/}/whtree"
  else
    export WEBHARE_DIR="$(cd ${BASH_SOURCE%/*}/..; pwd)"
  fi
fi
# Try to set WEBHARE_CHECKEDOUT_TO from WEBHARE_DIR where possible
if [ -z "$WEBHARE_CHECKEDOUT_TO" ]; then
  if [ -f "$WEBHARE_DIR/../builder/base_makefile" ]; then
    export WEBHARE_CHECKEDOUT_TO="$(cd ${WEBHARE_DIR}/..; pwd)"
  fi
fi


die()
{
  echo "$@" 1>&2
  exit 1
}

estimate_buildj()
{
  if [ -n "$WHBUILD_NUMPROC" ]; then
    return
  fi

  if [ "$WEBHARE_PLATFORM" == "darwin" ]; then
    WHBUILD_NUMPROC=$(( `sysctl hw.ncpu | cut -d":" -f2` + 1 ))
  elif [ "$WEBHARE_PLATFORM" == "linux" ]; then
    WHBUILD_NUMPROC=`LANG=en_US.utf8 lscpu 2>/dev/null | grep "^CPU(s):" | cut -d: -f2` #2>/dev/null because centos 5 util-linux does not include lscpu
    MAXPROC=$(( `cat /proc/meminfo | grep ^MemTotal | cut -b10-24` / 1024000 ))
    if [ -z "$WHBUILD_NUMPROC" ]; then
      WHBUILD_NUMPROC=4
    elif [ $WHBUILD_NUMPROC -gt $MAXPROC ]; then
      WHBUILD_NUMPROC=$MAXPROC
    fi
  else
    echo "Unable to estimate proper build flags"
    exit 1
  fi
}

setup_builddir()
{
  if [ -n "$WHBUILD_DEBUG" ]; then
    WHBUILD_DIPREFIX=debug-
  else
    WHBUILD_DIPREFIX=release-
  fi

  if [ -z "$WHBUILD_BUILDROOT" ]; then
    [ -n "$WEBHARE_CHECKEDOUT_TO" ] || die WEBHARE_CHECKEDOUT_TO not set
    WHBUILD_BUILDROOT="`cd $WEBHARE_CHECKEDOUT_TO; cd ..; echo $PWD/whbuild`"
  fi
  if [ -z "$WEBHARE_BUILDDIR" ]; then
    WEBHARE_BUILDDIR="`cd $WEBHARE_CHECKEDOUT_TO; DIRNAME="${PWD##*/}" ; cd ..; echo $PWD/whbuild/${WHBUILD_DIPREFIX}${DIRNAME}`"
  fi

  if [ -z "$WEBHARE_BUILDDIR" ]; then
    die "Haven't determined the WebHare builddir - your checkout looks too different from what I'm used to"
  fi
  mkdir -p "$WEBHARE_BUILDDIR"

  if [ -z "$WHBUILD_DOWNLOADCACHE" ]; then
    WHBUILD_DOWNLOADCACHE="$WEBHARE_BUILDDIR/downloadcache"
  fi
}

getwebhareversion()
{
  [ -n "$WEBHARE_DIR" ] || die "WEBHARE_DIR not set - couldn't figure out where the WebHare tree is"
  WEBHARE_VERSION="$(grep ^version= "$WEBHARE_DIR/etc/platform.conf" | cut -d= -f2)"

  [ -n "$WEBHARE_VERSION" ] || die "Could not get version number from $WEBHARE_DIR/etc/platform.conf"
  export WEBHARE_VERSION
}

export -f die setup_builddir getwebhareversion
export WEBHARE_PLATFORM

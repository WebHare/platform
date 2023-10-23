#!/bin/bash

# Helper functions for 'make' etc.
# 'wh' is allowed to depend on us but we want to not depend on 'wh' or anything outside the builder/ dir (and other stuff copied by wh builddocker)

if [[ "$OSTYPE" == "darwin"* ]]; then
  WEBHARE_PLATFORM="darwin"
else
  WEBHARE_PLATFORM="linux"
fi

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

die()
{
  echo "$@" 1>&2
  exit 1
}

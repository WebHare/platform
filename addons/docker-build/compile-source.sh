#!/bin/bash
# We can't mark this script as executable as it shouldn't be run on a build host. But we still need the she-bang for shellcheck

export CCACHE_DIR=/tmp/compile/ccache
export WHBUILD_NODEPS=1
export WHBUILD_ALLOW=1
export WHBUILD_LTO=1

source /opt/emsdk/emsdk_env.sh

if ! /opt/wh/whtree/bin/wh make install ; then
  echo C++ BUILD FAILED
  exit 1
fi

rm -rf /opt/wh/{README.md,addons,ap,base_makefile,blex,drawlib,harescript,parsers}

# We can't mark this script as executable as it shouldn't be run on a build host

VERSION=$1

if [ -z "$VERSION" ]; then
  echo "Version tag argument is required"
  exit 1
fi

ISOK=
if [ -d /tmp/aws/cache/aws-sdk-cpp/.git ]; then
  cd /tmp/aws/cache/aws-sdk-cpp/
  if [ "$(git remote get-url origin)" == "https://github.com/aws/aws-sdk-cpp.git" ] && git pull origin "$VERSION"; then
    ISOK=1
  else
    echo "Failed pulling master from origin"
  fi
fi
if [ -z "$ISOK" ]; then
  rm -rf /tmp/aws/cache/aws-sdk-cpp 2> /dev/null
  cd /tmp/aws/cache/
  if ! git clone --branch "$VERSION" https://github.com/aws/aws-sdk-cpp.git; then
    echo "Clone failed"
    exit 1
  fi
fi

cd /tmp/aws/cache/aws-sdk-cpp/
if ! git checkout "$VERSION"; then
  echo "Could not checkout version tag '$VERSION'"
  exit 1
fi

export CCACHE_DIR=/tmp/aws/cache/ccache

estimate_buildj()
{
  if [ -n "$WHBUILD_NUMPROC" ]; then
    return
  fi

  WHBUILD_NUMPROC=`LANG=en_US.utf8 lscpu 2>/dev/null | grep "^CPU(s):" | cut -d: -f2` #2>/dev/null because centos 5 util-linux does not include lscpu
  MAXPROC=$(( `cat /proc/meminfo | grep ^MemTotal | cut -b10-24` / 1024000 ))
  if [ -z "$WHBUILD_NUMPROC" ]; then
    WHBUILD_NUMPROC=4
  elif [ $WHBUILD_NUMPROC -gt $MAXPROC ]; then
    WHBUILD_NUMPROC=$MAXPROC
  fi
}

estimate_buildj

cd /tmp/aws/build
CC="ccache /usr/bin/cc" CXX="ccache /usr/bin/g++" cmake -DBUILD_ONLY="s3" /tmp/aws/cache/aws-sdk-cpp/
make -j $WHBUILD_NUMPROC
make install

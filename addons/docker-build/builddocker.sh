#!/bin/bash

if [ -z "$WEBHARE_BUILDDIR" ]; then
  echo "We expect to be launched by 'wh builddocker' "
  exit 1
fi

export DOCKER_BUILDKIT=1  # needed for cache mounts (ccache, npm cache)

DOCKERBUILDARGS=()
DESTDIR="`pwd`"
cd `dirname $0`

source $WEBHARE_DIR/lib/wh-functions.sh

while [[ $1 =~ ^-.* ]]; do
  if [ "$1" == "--checkout" ]; then
    shift
    GITCHECKOUT=$1
  elif [ "$1" == "--debug" ]; then
    DOCKERBUILDARGS+=(--build-arg)
    DOCKERBUILDARGS+=(DEBUG=1)
  elif [ "$1" == "--nopull" ]; then
    DOCKERPULLARG=""
  elif [ "$1" == "--nocache" -o "$1" == "--no-cache"  ]; then
    DOCKERBUILDARGS+=(--no-cache)
  elif [ "$1" == "--dockerfile" ]; then
    shift
    DOCKERBUILDARGS+=(-f)
    DOCKERBUILDARGS+=($1)
  elif [ "$1" == "--distcc" ]; then
    shift
    if [ -z "$1" ]; then
      echo "Missing distcc config"
      exit 1
    fi
    DOCKERBUILDARGS+=(--build-arg)
    DOCKERBUILDARGS+=("DISTCC_HOSTS=$1")
  else
    echo "Illegal option $1"
    exit 1
  fi
  shift
done

if [ -n "$CI_COMMIT_SHA" ]; then
  # validate CI environment
  BUILDING_INSIDE_CI=1
  echo "CI build detected ($CI_COMMIT_SHA)"
  echo "CI build - environment variables:"
  set | egrep '^(CI_|TESTFW_|WEBHARE_DEBUG)' | sort

  if [ -z "$CI_REGISTRY_IMAGE" ]; then
    echo "Please enable the container registry for this project"
    exit 1
  fi
fi

get_finaltag

pushd ../.. >/dev/null 2>&1
if [ ! -f base_makefile ]; then
  echo "`pwd` does not appear to be a proper WebHare source tree root"
  exit 1
fi
SOURCEDIR="`pwd`"


if [ -z "$DOCKERBUILDFOLDER" ]; then
  DOCKERBUILDFOLDER="$HOME/.webharebuild"
fi

if [ "$DOCKERSUDO" == "1" ]; then
  SUDO=sudo
else
  SUDO=
fi


popd  >/dev/null 2>&1

# Avoid polluting the build tree, we'll do our work in a private folder
WORKDIR="$WEBHARE_BUILDDIR/docker-build"
rm -rf $WORKDIR
mkdir -p $WORKDIR
cd $WORKDIR

if [ -n "$WHBUILDSECRET_INSTANTCLIENT_URL" ]; then
  echo $WHBUILDSECRET_INSTANTCLIENT_URL > instantclienturl.txt

  DOCKERBUILDARGS+=(--secret)
  DOCKERBUILDARGS+=(id=instantclienturl,src=instantclienturl.txt)
  DOCKERBUILDARGS+=(--build-arg)
  DOCKERBUILDARGS+=("WHBUILD_OCI=1")
fi

# select the right tar implementation, we need gnu-tar
if [ "`uname`" == "Darwin" ]; then
  if ! which gtar >/dev/null 2>&1 ; then
    brew install gnu-tar
  fi

  TAR=gtar
else
  TAR=tar
fi

CCACHE_SERVER=
DISTCC_HOSTS=
GITCHECKOUT=

DOCKERPULLARG=--pull

if [ "$#" != "0" ]; then
  echo "Invalid argument '$1'"
  echo "Syntax: builddocker.sh [ --withoutts ]"
  exit 1
fi

BUILDHASHDATA=$SOURCEDIR:$GITCHECKOUT

# unique workdir per checkout, so you can safely run multiple builddockers
if [ "`uname`" == "Darwin" ]; then
  BUILDHASH=$(echo $BUILDHASHDATA|md5)
else
  BUILDHASH=$(echo $BUILDHASHDATA|md5sum|cut -d' ' -f1)
fi

if [ -n "$GITCHECKOUT" ]; then
  echo "ORG SOURCEDIR=$SOURCEDIR"
  TEMPSOURCEDIR="/tmp/dockerbuildsource-$BUILDHASH"
  echo "SOURCEDIR=$TEMPSOURCEDIR"
  rm -rf -- $TEMPSOURCEDIR
  cp -ar -- $SOURCEDIR $TEMPSOURCEDIR
  cd $TEMPSOURCEDIR
  if ! git checkout -f $GITCHECKOUT; then
    echo "Error checking out '$GITCHECKOUT'"
    exit 1
  fi
  SOURCEDIR="$TEMPSOURCEDIR"
fi

#############################################################################

cd "$WORKDIR"
echo "builddocker work directory: $WORKDIR"
if ! cp -a $SOURCEDIR/addons/docker-build/* $WORKDIR/ ; then
  echo "Copy failed"
  exit 1
fi

echo ""
echo "Packaging source tree for the WebHare runner"

# Enable noisier progress info, otherwise we can't actually see what the long-taking steps are ding
DOCKERBUILDARGS+=(--progress)
DOCKERBUILDARGS+=(plain)

# Record CI information so we can verify eg. if this image really matches the most recent build
DOCKERBUILDARGS+=(--build-arg)
DOCKERBUILDARGS+=("CI_COMMIT_SHA=$CI_COMMIT_SHA")
DOCKERBUILDARGS+=(--build-arg)
DOCKERBUILDARGS+=("CI_COMMIT_REF_NAME=$CI_COMMIT_REF_NAME")
DOCKERBUILDARGS+=(--build-arg)
DOCKERBUILDARGS+=("CI_PIPELINE_ID=$CI_PIPELINE_ID")

if [ -z "$CI_COMMIT_SHA" ]; then
  # Not a CI build, try to get git commit and branch
  CI_COMMIT_SHA="`cd $SOURCEDIR ; git rev-parse HEAD 2> /dev/null`"
  CI_COMMIT_REF_NAME="`cd $SOURCEDIR ; git rev-parse --abbrev-ref HEAD 2> /dev/null`"
  if [ -n "$CI_COMMIT_SHA$CI_COMMIT_REF_NAME" ]; then
    echo "Building from git, branch '$CI_COMMIT_REF_NAME', commit '$CI_COMMIT_SHA'"
  fi
fi

# Grab the main build dirs
# (ADDME: improve separation, consider moving whlibs/whres back to buildtree, to have a clean 'build this (ap,harescript,...)' and 'run this (whtree)' dir.)

[ -d whtree ] && rm -rf whtree # remove old build data
if ! (cd $SOURCEDIR ; git ls-files -co --exclude-standard whtree | tar -c -T -) | $TAR x ; then
  echo "tar failed"
  exit 1
fi
if [ "${PIPESTATUS[0]}" != "0" ]; then
  echo "git archive failed with errorcode ${PIPESTATUS[0]}"
  exit 1
fi

[ -d tocompile ] && rm -rf tocompile
mkdir -p tocompile/whtree/lib tocompile/whtree/bin tocompile/whtree/modules/system/
cp -a $SOURCEDIR/{ap,base_makefile,blex,drawlib,harescript,parsers} tocompile/
# We need whlibs+whres to run the C++ harescript tests
mv whtree/modules/system/whlibs tocompile/whtree/modules/system/
mv whtree/modules/system/whres tocompile/whtree/modules/system/
# wh tool
mv whtree/lib/wh-functions.sh tocompile/whtree/lib
# we need 'wh' to be able to 'wh make' in the dockerfile
mv whtree/bin/wh tocompile/whtree/bin
# Fonts are also required in the tests
mv whtree/fonts tocompile/whtree/

# NPM package stuff
[ -d whtree-npm ] && rm -rf whtree-npm
mkdir whtree-npm
mv whtree/package*.json whtree-npm/

# Testsuite
rm -rf webhare_testsuite # remove any already present testsuite
if ! mv whtree/modules/webhare_testsuite . ; then
  echo Extracting webhare_testsuite failed ${PWD}
  exit 1
fi

# Compress testsuite for future use (during transition, some tests still need this)
mkdir -p dropins/opt/wh/whtree/
if ! tar zcf dropins/opt/wh/whtree/webhare_testsuite.tar.gz webhare_testsuite ; then
  echo Adding webhare_testsuite failed
  exit 1
fi
rm -rf webhare_testsuite

cat > .dockerignore << HERE
*/engines/pdfbox*.jar
HERE

# Create version info
mkdir -p dropins/opt/wh/whtree/modules/system/whres
cat > dropins/opt/wh/whtree/modules/system/whres/buildinfo << HERE
committag=$CI_COMMIT_SHA
builddate=`date +'%Y-%m-%d'`
buildtime=`date +'%H:%M:%S'`
branch=$CI_COMMIT_REF_NAME
version=$WEBHARE_VERSION
HERE

# Fix permissions (crontab files cannot be world-writable)
chmod 600 dropins/etc/cron.d/* 2>/dev/null

echo "Docker build args: ${DOCKERBUILDARGS[@]}"

# Build webhare image
if ! $SUDO docker build $DOCKERPULLARG "${DOCKERBUILDARGS[@]}" -t "$BUILD_IMAGE" . ; then
  echo "Build of webhare image ($BUILD_IMAGE) failed."
  exit 1
fi

# If requested, push to CI
if [ -n "$PUSH_BUILD_IMAGES" ]; then
  if ! $SUDO docker push "$BUILD_IMAGE" ; then
    echo Push of $BUILD_IMAGE failed
    exit 1
  fi
fi

# If building for CI, build artifccts to speed up the testsuite
if [ -n "$BUILDING_INSIDE_CI" ]; then

  echo "Creating assetpack $DESTDIR/build/webare_testsuite_assetpacks.tar.gz"

  CONTAINER=`$SUDO docker create -l webharecitype=testdocker -e WH_EXTRACTTESTSUITE=1 -e WEBHARE_ALLOWEPHEMERAL=1 $BUILD_IMAGE`
  echo "  (using container $CONTAINER)"
  TMPPACK=`mktemp -d`
  mkdir -p $DESTDIR/build/

  if ! ( $SUDO docker start $CONTAINER &&
         $SUDO docker exec $CONTAINER wh waitfor poststartdone &&
         $SUDO docker exec $CONTAINER wh assetpacks wait webhare_testsuite:basetest &&
         $SUDO docker cp $CONTAINER:/opt/whdata/publisher.ap/webhare_testsuite.basetest $TMPPACK/ &&
         $SUDO docker rm -f $CONTAINER ) ; then
    echo "Unable to create assetpack"
    exit 1
  fi

  ( cd $TMPPACK/ ; tar zcf $DESTDIR/build/webare_testsuite_assetpacks.tar.gz webhare_testsuite.basetest )
  rm -rf -- $TMPPACK
fi

echo "------results---------"
echo "Built $BUILD_IMAGE"
exit 0

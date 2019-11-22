#!/bin/bash
# parameters: $1: source dir, $2: builddir
SRCDIR=$1
BINDIR=$2/bin

if [ "$MODULEDIR" == "" ]; then
  MODULEDIR=$2/lib
fi

BUILD=$2/
TESTDIR="$2/harescript/tests"

[ -n "$DEBUGMAKE" ] && echo Running in ${TESTDIR}

export WHTREE=$SRCDIR/whtree

cat > ${TESTDIR}/hsengine.xml << HERE
<hsengine version="1" xmlns="http://www.webhare.net/xmlns/harescript/hsengine">
  <!-- Basic configuration file for the separate HareScript Engine
       All relative paths are relative to the location of this xml file
  -->

  <namespace name="wh" path="$WHTREE/modules/system/whlibs" />
  <namespace name="whres" path="$WHTREE/modules/system/whres" />
  <namespace name="test" path="$WHTREE/modules/webhare_testsuite/tests/baselibs/hsengine" />
  <resources path="$WHTREE/modules/system/whres" />
  <compilecache path="$TESTDIR" />
  <dynamiclibrarydir path="$MODULEDIR" />
</hsengine>
HERE

export HSENGINE_CONFIG=

ulimit -c unlimited
export WEBHARE_HS_TEST_CONFIG=${TESTDIR}/hsengine.xml
export WEBHARE_HS_TEST_EXECUTABLE=$BINDIR/hsrun
run="$TESTWRAPPER $RUNWRAPPER $BINDIR/hsrun --config ${TESTDIR}/hsengine.xml --workerthreads 2"

if [ "$NOHSMODUNLOAD" == "1" ]; then
  run="$run --nohsmodunload"
fi

# Copy testfiles to testdir
[ -d $TESTDIR ] || mkdir -p $TESTDIR

# remove all old files
rm -rf $TESTDIR/*.clib

#if ! ${run} test::test_${HSTEST}.whlib $BUILD/utils $TESTDIR $TESTDIR $TESTDIR
if [ -n "$HSTEST" -a "$HSTEST" != "all" ]; then
  TESTLIST="test_${HSTEST}.whscr"
else
  TESTLIST=`cd $WHTREE/modules/webhare_testsuite/tests/baselibs/hsengine ; ls test_*.whscr`
fi

CURRENTTEST=""
FAILEDTESTS=""
export CURRENTTEST

# when interrupt, print current test so we know which one might be stuck
trap "echo Aborted test: `echo '$CURRENTTEST'` ; exit 254" SIGINT SIGTERM

for CURRENTTEST in $TESTLIST ; do
  if ! ${run} "test::${CURRENTTEST}" ; then
    FAILEDTESTS="$FAILEDTESTS $CURRENTTEST"
  fi
done

if [ -n "$FAILEDTESTS" ]; then
  echo "Run failed! ( any coredump can be found in $TESTDIR )"
  echo "Failed tests:$FAILEDTESTS"
  echo "export WHTREE=$SRCDIR/whtree"
  echo "${run} test::test_${FAILEDTESTS%% *}.whscr"
  exit 1
fi

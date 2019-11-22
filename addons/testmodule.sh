#!/bin/sh

# This script is maintained at webhare/webhare repository, addons/testmodule.sh - 'develop' branch builds automatically update this script
# This script and its URL exist to allow us to update how the module CI works without updating individual .gitlab-ci.yamls too often
#
# Invoke us like this
# curl -s https://build.webhare.dev/ci/scripts/testmodule.sh | bash -s -- [options]

MKTEMP=`mktemp -d`
mkdir -p "$MKTEMP"

function cleanup()
{
  rm -rf -- "$MKTEMP"
}

trap cleanup EXIT # clean up our tmp on interrupt

if ! curl -fs https://build.webhare.dev/ci/scripts/testdocker.sh -o "$MKTEMP"/testdocker.sh ; then
  echo Download of testdocker.sh failed
  exit 1
fi
if ! curl -fs https://build.webhare.dev/ci/scripts/functions.sh -o "$MKTEMP"/functions.sh ; then
  echo Download of functions.sh failed
  exit 1
fi

chmod a+x "$MKTEMP"/testdocker.sh
"$MKTEMP"/testdocker.sh -m "$@"
TESTRESULT=$?

exit $TESTRESULT

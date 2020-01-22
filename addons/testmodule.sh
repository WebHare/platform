#!/bin/bash -x

# This script is maintained at https://gitlab.com/webhare/platform/blob/master/addons/testmodule.sh - 'master' branch builds
# automatically update the online version at https://build.webhare.dev/ci/scripts/testmodule.sh
#
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
if ! curl -fs https://build.webhare.dev/ci/scripts/wh-functions.sh -o "$MKTEMP"/wh-functions.sh ; then
  echo Download of wh-functions.sh failed
  exit 1
fi

chmod a+x "$MKTEMP"/testdocker.sh
"$MKTEMP"/testdocker.sh -m "$@"
TESTRESULT=$?

exit $TESTRESULT

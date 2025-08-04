#!/bin/bash -x

# This script is maintained at https://gitlab.com/webhare/platform/blob/master/addons/testmodule.sh - 'master' branch builds
# automatically update the online version at https://build.webhare.dev/ci/scripts/testmodule.sh
#
# This script and its URL exist to allow us to update how the module CI works without updating individual .gitlab-ci.yamls too often
#
# Invoke us like this
# curl -s https://build.webhare.dev/ci/scripts/testmodule.sh | bash -s -- [options]

MKTEMP="$(mktemp -d)"
mkdir -p "$MKTEMP"

function cleanup()
{
  rm -rf -- "$MKTEMP"
}

trap cleanup EXIT # clean up our tmp on interrupt

for P in make-functions.sh wh-functions.sh testcontainer.sh; do
  if ! curl --fail --silent "https://build.webhare.dev/ci/scripts/$P" -o "${MKTEMP}/${P}" ; then
    echo "Download of $P failed"
    exit 1
  fi
done

chmod a+x "$MKTEMP"/testcontainer.sh
"$MKTEMP"/testcontainer.sh -m "$@"
TESTRESULT=$?

exit $TESTRESULT

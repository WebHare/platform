#!/bin/bash
BASEDIR=`dirname $0`

if [ -z "$WHBUILD_BUILDBOTPASSWORD" ]; then
  echo "WHBUILD_BUILDBOTPASSWORD not set"
  exit 1
fi

curl --user "info+buildbot@webhare.nl:$WHBUILD_BUILDBOTPASSWORD" -T $BASEDIR/testmodule.sh https://cms1.webhare.com/webdav/publisher/ci/testmodule.sh
curl --user "info+buildbot@webhare.nl:$WHBUILD_BUILDBOTPASSWORD" -T $BASEDIR/docker-build/testdocker.sh https://cms1.webhare.com/webdav/publisher/ci/testdocker.sh
curl --user "info+buildbot@webhare.nl:$WHBUILD_BUILDBOTPASSWORD" -T $BASEDIR/docker-build/functions.sh https://cms1.webhare.com/webdav/publisher/ci/functions.sh

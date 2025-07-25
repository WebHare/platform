#!/bin/bash
BASEDIR=`dirname $0`

if [ -z "$WHBUILD_BUILDBOTPASSWORD" ]; then
  echo "WHBUILD_BUILDBOTPASSWORD not set"
  exit 1
fi

if ! ( curl --fail --user "info+buildbot@webhare.nl:$WHBUILD_BUILDBOTPASSWORD" -T $BASEDIR/testmodule.sh https://cms.webhare.dev/webdav/publisher/scripts/testmodule.sh &&
       curl --fail --user "info+buildbot@webhare.nl:$WHBUILD_BUILDBOTPASSWORD" -T $BASEDIR/docker-build/testdocker.sh https://cms.webhare.dev/webdav/publisher/scripts/testdocker.sh &&
       curl --fail --user "info+buildbot@webhare.nl:$WHBUILD_BUILDBOTPASSWORD" -T $BASEDIR/docker-build/testdocker.sh https://cms.webhare.dev/webdav/publisher/scripts/testcontainer.sh &&
       curl --fail --user "info+buildbot@webhare.nl:$WHBUILD_BUILDBOTPASSWORD" -T $BASEDIR/../whtree/lib/make-functions.sh https://cms.webhare.dev/webdav/publisher/scripts/make-functions.sh &&
       curl --fail --user "info+buildbot@webhare.nl:$WHBUILD_BUILDBOTPASSWORD" -T $BASEDIR/../whtree/lib/wh-functions.sh https://cms.webhare.dev/webdav/publisher/scripts/wh-functions.sh ) ; then
  echo "Upload failed"
  exit 1
fi

exit 0

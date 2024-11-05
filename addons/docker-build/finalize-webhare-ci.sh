#!/bin/bash
ERRORCODE=0

if ! node /opt/whdata/installedmodules/webhare_testsuite/js/ci/check-caches.mjs verify /tmp/cacheinfo ; then
  echo Failed to record cache info
  ERRORCODE=1
fi

exit $ERRORCODE

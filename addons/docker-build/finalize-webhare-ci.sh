#!/bin/bash
ERRORCODE=0

if ! node /opt/whdata/installedmodules/webhare_testsuite/js/ci/check-caches.mjs verify /tmp/cacheinfo ; then
  echo Cache validation failed
  ERRORCODE=1
fi

exit $ERRORCODE

#!/bin/bash
if ! node /opt/whdata/installedmodules/webhare_testsuite/js/ci/check-caches.mjs record /tmp/cacheinfo ; then
  echo Failed to record cache info
fi

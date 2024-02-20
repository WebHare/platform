#!/bin/bash

if [ -n "$WEBHARE_IN_DOCKER" ]; then
  # http://smarden.org/runit/chpst.8.html - part of runit tools
  # start chrome sa safe user. keep it away from stdin just in case.
  #export HOME=/home/chrome

  # FIXME might be cleaner to explicitly pass a datadir by giving puppeteer a `userDataDir` but then we still need to know the dir here (or fix permissions in JS)
  chown -R chrome:chrome -- /tmp/puppeteer_dev_chrome_profile*
  export XDG_CONFIG_HOME=/tmp/.chromium
  export XDG_CACHE_HOME=/tmp/.chromium
  exec chpst -u chrome:chrome "$CHROMIUM_PATH" --no-sandbox "$@" < /dev/null
else
  # Starting chrome 'normally'
  exec "$CHROMIUM_PATH" "$@"
fi

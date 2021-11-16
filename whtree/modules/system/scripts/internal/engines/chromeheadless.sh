#!/bin/bash

# Inside the Docker image: /opt/wh/whtree/modules/system/scripts/internal/engines/chromeheadless.sh --no-sandbox --headless --remote-debugging-port=9002
#
# To manually run an instance of chrome, try running whtree/modules/system/scripts/internal/engines/chromeheadless.sh -remote-debugging-port=9999
# And add eg `[ devtoolsurl := "http://127.0.0.1:9999/" ]` in the second parameter of GeneratePDF
#

if [ -n "$WEBHARE_IN_DOCKER" ]; then
  PROFILEDIR=/home/chrome/profile
else
  PROFILEDIR="$HOME/.chrome-headless-profile"
fi

# Make sure our chrome state is completely clean
if [ -e "$PROFILEDIR" ]; then
  mv -- "$PROFILEDIR" "$PROFILEDIR.bak"
  rm -rf -- "$PROFILEDIR.bak"
fi

mkdir -p -- "$PROFILEDIR"

# --disk-cache-dir=/dev/null seems to be the preferred method on the interwebs but is now crashing - https://bugs.chromium.org/p/chromium/issues/detail?id=1262129
# as far as I know there's no officially sanctioned way to fully disable the cache so we'll go for session-level enabling in tests/pdf rendering

ARGS="--disable-gpu
      --no-first-run
      --disable-translate
      --disable-extensions
      --disable-background-networking
      --safebrowsing-disable-auto-update
      --disable-sync
      --metrics-recording-only
      --disable-default-apps
      --disk-cache-size=1
      --window-size=1280,1024
      --force-color-profile=srgb
      --disable-dev-shm-usage
      --mute-audio
      --user-data-dir=$PROFILEDIR"

if [ -n "$WEBHARE_IN_DOCKER" ]; then
  # http://smarden.org/runit/chpst.8.html - part of runit tools
  # start chrome sa safe user. keep it away from stdin just in case.
  export HOME=/home/chrome
  chown -R chrome:chrome -- "$PROFILEDIR"
  exec chpst -u chrome:chrome /usr/bin/google-chrome $ARGS "$@" < /dev/null
else
  # Starting chrome 'normally'
  if [ "`uname`" == "Darwin" ]; then
    exec "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" $ARGS "$@"
  else
    exec "/usr/bin/google-chrome" $ARGS "$@"
  fi
fi

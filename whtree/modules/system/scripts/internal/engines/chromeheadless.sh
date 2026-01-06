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

# Find a browser in PUPPETEER_CACHE_DIR first. This one will have proper hyphenations
BROWSER=$(find "$PUPPETEER_CACHE_DIR" -type f -name chrome | head -n1)

if [ -z "$BROWSER" ]; then
  # If not found, try to find a browser in the system
  if [ "`uname`" == "Darwin" ]; then
    BROWSER="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  elif [ -x /usr/bin/google-chrome ]; then
    BROWSER="/usr/bin/google-chrome"
  else
    BROWSER="/usr/bin/chromium-browser"
  fi
fi

if [ -n "$WEBHARE_IN_DOCKER" ]; then
  # http://smarden.org/runit/chpst.8.html - part of runit tools
  # start chrome sa safe user. keep it away from stdin just in case.
  export HOME=/home/chrome
  chown -R chrome:chrome -- "$PROFILEDIR"

  CHPST=""
  if hash -r chpst 2>/dev/null; then
    CHPST="chpst -u chrome:chrome"
  elif hash -r setpriv 2>/dev/null; then
    CHPST="setpriv --reuid=chrome --regid=chrome --init-groups "
  else
    echo "Error: neither chpst nor setpriv available" >&2
    exit 1
  fi

  exec $CHPST "$BROWSER" $ARGS "$@" < /dev/null
else
  # Starting chrome 'normally'
  exec "$BROWSER" $ARGS "$@"
fi

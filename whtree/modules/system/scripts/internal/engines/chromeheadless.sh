#!/bin/bash

# Inside the Docker image: /opt/wh/whtree/modules/system/scripts/internal/engines/chromeheadless.sh --no-sandbox --headless --remote-debugging-port=9002
#
# To manually run an instance of chrome, try running whtree/modules/system/scripts/internal/engines/chromeheadless.sh -remote-debugging-port=9999
# And add eg `[ devtoolsurl := "http://127.0.0.1:9999/" ]` in the second parameter of GeneratePDF
#

# Setuid helper for containers running WebHare as an unprivileged user (see ap/utils/whprivileged.cpp)
WEBHARE_PRIVILEGED=/opt/container/whprivileged

# Make sure our chrome state is completely clean
RESETPROFILE='if [ -e "$1" ]; then mv -- "$1" "$1.bak" && rm -rf -- "$1.bak"; fi; mkdir -p -- "$1"'

if [ -n "$WEBHARE_IN_DOCKER" ]; then
  PROFILEDIR=/home/chrome/profile
else
  PROFILEDIR="$HOME/.chrome-headless-profile"
fi

if [ -z "$WEBHARE_IN_DOCKER" ] || [ -z "$WEBHARE_DOCKER_USER" ]; then
  /bin/bash -c "$RESETPROFILE" -- "$PROFILEDIR"
fi # else: we can't touch /home/chrome, the profile will be reset as user chrome just before launching chrome

cd "$WEBHARE_DIR"

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
BROWSER="$(wh node -e 'require("puppeteer").executablePath().then(_=>console.log(_))')"

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

  if [ -n "$WEBHARE_DOCKER_USER" ]; then
    # Reset the profile as user chrome and then start the browser
    exec "$WEBHARE_PRIVILEGED" run-as chrome /bin/bash -c "$RESETPROFILE"' && shift && exec "$@"' -- "$PROFILEDIR" "$BROWSER" $ARGS "$@" < /dev/null
  fi

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

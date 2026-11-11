#!/bin/bash

# Setuid helper for containers running WebHare as an unprivileged user (see ap/utils/whprivileged.cpp)
WEBHARE_PRIVILEGED=/opt/container/whprivileged

if [ -n "$WEBHARE_IN_DOCKER" ]; then
  # start chrome as a safe user. keep it away from stdin just in case.

  export XDG_CONFIG_HOME=/tmp/.chromium
  export XDG_CACHE_HOME=/tmp/.chromium

  if [ -z "$WEBHARE_DOCKER_USER" ]; then
    # FIXME might be cleaner to explicitly pass a datadir by giving puppeteer a `userDataDir` but then we still need to know the dir here (or fix permissions in JS)
    chown -R chrome:chrome -- /tmp/puppeteer_dev_chrome_profile*
  else
    # We can't chown the profile directory puppeteer created for us (mode 0700) so open it up for user chrome
    # FIXME puppeteer (running as us) can't fully clean up the files chrome creates in there
    for ARG in "$@"; do
      if [[ "$ARG" == --user-data-dir=* ]]; then
        chmod 0777 -- "${ARG#--user-data-dir=}"
      fi
    done
  fi

  if [ -n "$WEBHARE_DOCKER_USER" ]; then
    CHPST="$WEBHARE_PRIVILEGED run-as chrome "
  elif hash -r chpst 2>/dev/null; then # http://smarden.org/runit/chpst.8.html - part of runit tools
    CHPST="chpst -u chrome:chrome "
  elif hash -r setpriv 2>/dev/null; then
    CHPST="setpriv --reuid=chrome --regid=chrome --init-groups "
  else
    echo "Error: neither chpst nor setpriv available" >&2
    exit 1
  fi

  exec $CHPST "$CHROMIUM_PATH" --no-sandbox "$@" < /dev/null
else
  # Starting chrome 'normally'
  exec "$CHROMIUM_PATH" "$@"
fi

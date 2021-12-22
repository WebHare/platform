#!/bin/bash

# This script is used when building WebHare to create the bootstrap packages

## How to test shrinkwrapping
#  - Run ~/projects/webhare/whtree/modules/system/scripts/internal/create_shrinkwrap.sh
#  - Note the time
#  - Delete your whdata/publisher.pd and whdata/publisher.pd directories
#  - Restart your WebHare
#  - Verify that whdata/publisher.pd and whdata/publisher.pd and their files are 'older' than the noted time


cd `dirname $0`
# We are in whtree/modules/system/scripts/internal, we need to find whtree, so 4 up!
cd ../../../..
WHTREE="`pwd`"

if [ ! -f "$WHTREE/bin/runscript" ]; then
  echo "$WHTREE/bin/runscript does not exist - build failed or wrong directory"
  exit 1
fi

function stop_webhare()
{
  local PID
  PID=$1
  if ps $PID | grep "webhare.*create_shrinkwrap.*daemon" >/dev/null ;  then
    echo -n "Stopping shrinkwrap WebHare with PID $PID: "
    kill -TERM "$PID"
    sleep 1

    # Verify that it has gone away
    while ( kill -n 0 "$PID" 2>/dev/null );
    do
      echo -n ".";
      sleep 1
    done
    echo "OK"
  fi
}

if [ -z "$WEBHARE_IN_DOCKER" ]; then #Not inside docker, setup save working environment for testing
  if [ -z "$SHRINKWRAPBASEDIR" ]; then
    SHRINKWRAPBASEDIR=/tmp/.webharebuild/
  fi
  if [ "${SHRINKWRAPBASEDIR%/}" == "${SHRINKWRAPBASEDIR}" ]; then
    SHRINKWRAPBASEDIR="${SHRINKWRAPBASEDIR}/"
  fi

  # Shutdown existing instances
  for PIDFILE in "${SHRINKWRAPBASEDIR}"create_shrinkwrap.*/.webhare.pid ; do
    PID=`cat $PIDFILE 2>/dev/null`
    if [ -z "$PID" ]; then
      continue;
    fi
    stop_webhare $PID
  done

  # Destroy existing instances
  rm -rf -- /"${SHRINKWRAPBASEDIR}"create_shrinkwrap.* 2>/dev/null
  export WEBHARE_DATAROOT="${SHRINKWRAPBASEDIR}create_shrinkwrap.$$"
  export WEBHARE_BASEPORT=38679
fi

# FIXME We're downloading 'm anyway, have shrinkwrap pack the geolite databases too
echo "Launching WebHare"
export WEBHARE_NOUPDATEGEOIP=1
$WHTREE/bin/wh console &
while true ; do
  PID="`cat $WEBHARE_DATAROOT/.webhare.pid 2>/dev/null`"
  if [ -n "$PID" ]; then
    break
  fi
  sleep 0.1
done
echo "Launched with PID $PID"

function cleanup()
{
  stop_webhare $PID
}

trap cleanup EXIT

# FIXME we could do a final 'nothing odd in the logfiles?' check here
EXITCODE=0
if which timeout >/dev/null ; then
  TIMEOUT="timeout 60000"
fi

if ! $TIMEOUT $WHTREE/bin/wh run mod::system/scripts/internal/shrinkwrap.whscr $WHTREE/modules/system/data/shrinkwrap-var.tgz ; then
  echo "shrinkwrap.whscr failed!"
  EXITCODE=1
fi

 # we screenshot the webinterface just to check there are no obvious JS errors
if ! $TIMEOUT $WHTREE/bin/wh webserver addport --virtual 38600 ; then
  echo "creating interface port failed"
  EXITCODE=1
fi

if ! $TIMEOUT $WHTREE/bin/wh webserver addbackend http://localhost:38600/ ; then
  echo "creating interface webserver failed"
  EXITCODE=1
fi

if ! $TIMEOUT $WHTREE/bin/wh screenshot -o /tmp/screenshot.png --abortonlogerrors --delay 5000 http://localhost:38600/ ; then
  echo "error getting login interface screenshot (probably got javascript errors)"
  EXITCODE=1
fi

# consistency check
if ! $TIMEOUT $WHTREE/bin/wh checkwebhare ; then
  echo "self-consistency check failed"
  EXITCODE=1
fi

if ! [ -c /dev/null ] ; then
  echo "/dev/null is not a character device. something overwrote it"
  EXITCODE=1
fi

exit $EXITCODE

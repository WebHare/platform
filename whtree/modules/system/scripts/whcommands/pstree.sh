#!/bin/bash
source $WEBHARE_DIR/lib/wh-functions.sh

get_webhare_pid PID
if [ -z "$PID" ]; then
  echo WebHare does not appear to be running
  exit 1
fi

pstree $PID
exit 0

#!/bin/bash
source $WEBHARE_DIR/lib/wh-functions.sh

get_webhare_pid PID
if [ -z "$PID" ]; then
  echo WebHare does not appear to be running
  exit 1
fi

if ! which pstree >/dev/null 2>&1 ; then
  echo "pstree does not appear to be installed"
  echo "Try: brew install pstree"
  exit 1
fi

exec pstree $PID

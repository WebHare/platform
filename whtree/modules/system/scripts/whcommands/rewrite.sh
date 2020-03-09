#!/bin/bash

# a temporary forwarder until Sublime is updated and people are used to writing dev;rewrite

if ! $WEBHARE_DIR/bin/wh getmoduledir dev >/dev/null 2>/dev/null ; then
  echo "Install dev module to use 'wh rewrite'"
  exit 1
fi
exec $WEBHARE_DIR/bin/wh dev:rewrite "$@"

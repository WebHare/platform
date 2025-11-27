#!/bin/bash

if [ -z "$WEBHARE_DATAROOT" ]; then
  echo "WEBHARE_DATAROOT name not set"
  exit 1
fi

# We need this until the toplevel service manager can restart us
echo $$ > $WEBHARE_DATAROOT/.webhare-webserver.pid

if [ "$WEBHARE_WEBSERVER" != "node" ]; then
  echo "Starting HareScript webserver"
  exec "${BASH_SOURCE%/*}/webserver"
fi

exec $WEBHARE_DIR/bin/wh run mod::system/js/internal/webserver/cli-webserver.ts

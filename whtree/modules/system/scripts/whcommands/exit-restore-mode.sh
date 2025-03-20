#!/bin/bash
# short: exit restore mode

if [ ! -e "$WEBHARE_DATAROOT/webhare.restoremode" ]; then
  if [ -z "$WEBHARE_ISRESTORED" ]; then
    echo "This WebHare does not appear to run in restore mode"
    exit 1
  fi
  echo "This WebHare has not placed into restore mode by using a webhare.restoremode file. You may need to manually fix the environment variables."
  exit 1
fi

rm -f "$WEBHARE_DATAROOT/webhare.restoremode"
if [ -e "$WEBHARE_DATAROOT/webhare.restoremode" ]; then
  echo "Failed to remove restoremode file"
  exit 1
fi

echo "webhare.restoremode has been removed, restarting WebHare to finally exit restore mode"
wh service relaunch

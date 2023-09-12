#!/bin/bash
if [ -z "$WEBHARE_DATAROOT" ]; then
  echo WEBHARE_DATAROOT not set
  exit 1
fi

rm -rf -- "$WEBHARE_DATAROOT"/preparedbackup
mkdir -p -- "$WEBHARE_DATAROOT"/preparedbackup
exec "$WEBHARE_DIR"/modules/system/scripts/internal/runbackup.sh "$WEBHARE_DATAROOT"/preparedbackup

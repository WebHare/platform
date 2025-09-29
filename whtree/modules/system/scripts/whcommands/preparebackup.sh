#!/bin/bash
if [ -z "$WEBHARE_DATAROOT" ]; then
  echo WEBHARE_DATAROOT not set
  exit 1
fi

exec "${WEBHARE_DIR}/modules/system/scripts/internal/runbackup.sh" "${WEBHARE_DATAROOT}preparedbackup"

#!/bin/bash
# short: Create a backup of the database

source "$WEBHARE_DIR/lib/wh-functions.sh"
getwhparameters

TARGETDIR="$WEBHARE_DATAROOT/backups/$(date +%Y-%m-%dT%H.%M.%S)"
mkdir -p -- "$TARGETDIR"

echo "Creating backup in: $TARGETDIR"
exec "$WEBHARE_DIR/modules/system/scripts/internal/runbackup.sh" "$TARGETDIR"

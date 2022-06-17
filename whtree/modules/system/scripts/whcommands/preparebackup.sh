#!/bin/bash

if ! [ -f /opt/whdata/.webhare-envsettings.sh ]; then
  echo "This script should only be run on a WebHare inside docker. Use \`wh backuplocal\` for local backups"
  exit 1
fi

rm -rf -- /opt/whdata/preparedbackup
mkdir -p -- /opt/whdata/preparedbackup
exec /opt/wh/whtree/modules/system/scripts/internal/runbackup.sh /opt/whdata/preparedbackup

#!/bin/bash

if [ -z "$WH_RESTORE_PORT" ]; then
  echo Missing WH_RESTORE_PORT
  exit 1
fi

if [ -z "$SSH_AUTH_SOCK" ]; then
  echo "No SSH socket set (darwin host?)"
  eval `ssh-agent`
  ssh-add
else
  echo "SSH socket is $SSH_AUTH_SOCK (linux host?)"
fi

if [ -n "$WH_RESTORE_VERBOSE" ]; then
  set -x
fi

# Preflight checks
if [ -f "/opt/whdata/restore-in-progress" ]; then
  echo "Previous restore did not complete properly"
  exit 1
fi

# Mount the source data
touch "/opt/whdata/restore-in-progress"

echo "Mounting backup sources"
if [ -n "$WH_RESTORE_FILESSOURCE" ]; then
  mkdir -p /opt/backups/files
  if ! sshfs "$WH_RESTORE_FILESSOURCE" /opt/backups/files -o StrictHostKeyChecking=no,ro,auto_cache,reconnect"$WH_RESTORE_SSHFSOPTS"; then
    echo "Failed to mount files backup"
    exit 1
  fi
fi

if [ -n "$WH_RESTORE_DATABASESOURCE" ]; then
  if [ -z "$WH_RESTORE_DATABASESOURCEMOUNT" ]; then
    WH_RESTORE_DATABASESOURCEMOUNT=/opt/backups/database
  fi
  mkdir -p "$WH_RESTORE_DATABASESOURCEMOUNT"
  if ! sshfs "$WH_RESTORE_DATABASESOURCE" "$WH_RESTORE_DATABASESOURCEMOUNT" -o StrictHostKeyChecking=no,ro,auto_cache,reconnect"$WH_RESTORE_SSHFSOPTS"; then
    echo "Failed to mount database backup"
    exit 1
  fi
fi

# Copy installed modules and fonts (if they exist)
mkdir -p /opt/whdata/installedmodules/
if [ -z "$WH_RESTORE_SKIPMODULERESTORE" ]; then
  cp -R /opt/backups/files/opt/whdata/installedmodules/* /opt/whdata/installedmodules/
fi
mkdir -p /opt/whdata/fonts
mkdir -p /opt/whdata/log
if [ -d /opt/backups/files/opt/whdata/fonts/ ]; then
  cp -R /opt/backups/files/opt/whdata/fonts/* /opt/whdata/fonts
fi

# want installationtype="restore"
if ! grep -q 'installationtype="restore"' $WEBHARE_CONFIG; then
  echo "Configuration file does not have the right installationtype"
  exit 1
fi

# symlink-restore the database
cd /opt/whdata/
if ! wh symlinkrestoredb "$WH_RESTORE_DATABASESOURCEMOUNT" /opt/whdata/dbase; then
  echo "Failed to restore database"
  exit 1;
fi

# Make sure the database backup is mounted at the next container start
echo "# Backup mount restore config" > /opt/whdata/backupmountconfig
echo "WEBHARE_CONFIG=\"$WEBHARE_CONFIG\"" >> /opt/whdata/backupmountconfig
echo "WH_RESTORE_DATABASESOURCE=\"$WH_RESTORE_DATABASESOURCE\"" >> /opt/whdata/backupmountconfig
echo "WH_RESTORE_DATABASESOURCEMOUNT=\"$WH_RESTORE_DATABASESOURCEMOUNT\"" >> /opt/whdata/backupmountconfig
echo "WH_RESTORE_SSHFSOPTS=\"$WH_RESTORE_SSHFSOPTS\"" >> /opt/whdata/backupmountconfig


# Determine the database port
WEBHARE_DATABASEPORTLINE=$(/opt/wh/whtree/bin/webhare printparameters | grep "WEBHARE_DATABASEPORT=")
WEBHARE_DATABASEPORT=${WEBHARE_DATABASEPORTLINE#*=}

# Start dbserver as first job (%1), then the whmanager
echo "Starting whmanager and database"
/opt/wh/whtree/bin/dbserver --listen 127.0.0.1:$WEBHARE_DATABASEPORT --dbasefolder /opt/whdata/dbase &
/opt/wh/whtree/bin/whmanager &

# Wait until the database server listen port opens
DATABASE_RUNNING=
for i in {1..60}; do
  sleep 1
  if ss -ltnp | grep -q ":$WEBHARE_DATABASEPORT "; then
    DATABASE_RUNNING=1
    break;
  fi
done

if [ -z "$DATABASE_RUNNING" ]; then
  echo "Database did not start properly"
  exit 1
fi

SETUPOPTS="--hostname $WH_RESTORE_HOSTNAME"
if [ -n "$WH_RESTORE_AS_DOCKER" ]; then
  SETUPOPTS="$SETUPOPTS --norenumber"
else
  SETUPOPTS="$SETUPOPTS --port=$WH_RESTORE_PORT"
fi

if [ -n "$WH_RESTORE_DATADIR" ]; then
  SETUPOPTS="$SETUPOPTS --datadir=$WH_RESTORE_DATADIR"
fi

echo "Prepare restored installation for use"
mkdir -p /opt/whdata/tmp/
if ! wh run modulescript::system/database/setupclone.whscr --mutexmgr $SETUPOPTS; then
  echo "Failed to prepare the restored installation"
  exit 1
fi

echo "Shutting down db server"
kill %1
wait %1

rm -f "/opt/whdata/restore-in-progress"
echo "Webhare restore completed"

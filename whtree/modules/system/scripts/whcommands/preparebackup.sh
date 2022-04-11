#!/bin/bash
# FIXME in the webhare builtin version, we can remove support for 4.08 and WHDB soon
if [ ! -f /opt/whdata/.webhare-envsettings.sh ] && [ -x /opt/wh/whtree/bin/wh-upgrade-webhare.sh ]; then
  echo WH 4.08 or similar detected
  STORAGEPATH=/opt/whdata/dbase
else
  source /opt/whdata/.webhare-envsettings.sh
  source $WEBHARE_DIR/lib/wh-functions.sh

  getwhparameters
  if [ -z "$STORAGEPATH" ];then
    echo "Failed to retrieve database configuration"
    exit 1
  fi

  if ! is_webhare_running; then
    echo "WebHare must be running for a backup";
    exit 1
  fi
fi

echo "STORAGEPATH: $STORAGEPATH"

BACKUPDEST="/opt/whdata/preparedbackup"
rm -rf "$BACKUPDEST"
mkdir -p $BACKUPDEST

echo "BACKUP DESTINATION: $BACKUPDEST"

if [ -f "$BACKUPDEST/dbase/translog.whdb" -o -f "$BACKUPDEST/postgresql/db/postgresql.conf" ]; then
  echo "$1 already seems to contain a database, it will be overwritten!"
  echo "Press enter to continue, or CTRL+C to abort now"
  read
fi

RSYNCOPTS="--info=progress2"

mkdir -p "$BACKUPDEST"

rm -rf -- "$BACKUPDEST/dbase" "$BACKUPDEST/postgresql" "$BACKUPDEST/backup" "$BACKUPDEST/blob"
mkdir -p -- "$BACKUPDEST/backup" "$BACKUPDEST/blob"
BLOBDEST="$BACKUPDEST"

function control_c()
{
  echo "SIGINT"
  kill %1
  kill %2
  exit 1
}

if pidof dbserver; then
  # Start job control, needed to start backup in background
  set -m
  trap control_c SIGINT


  [ "$VERBOSE" == "1" ] && echo "Launching backup process"
  "/opt/wh/whtree/bin/backup" -cp --threads --blobmode=reference --suspendfile $BACKUPDEST/backup/suspend $BACKUPDEST/backup/backup > $BACKUPDEST/backuplog 2>&1 &
  tail -n 1000 -f "$BACKUPDEST/backuplog" &

  while [ ! -f "$BACKUPDEST/backup/suspend" ]; do
    sleep .1
  done

  echo "Copying/linking blobs..."
  [ "$VERBOSE" == "1" ] && MYOPTS=-v

  for BLOBBASEFOLDER in blob ` cd $STORAGEPATH ; echo blob-* `; do
    if [ ! -d "$STORAGEPATH/$BLOBBASEFOLDER" ]; then
      continue
    fi

    for BLOBSUBFOLDER in ` cd "$STORAGEPATH/$BLOBBASEFOLDER"; echo *` ; do
      mkdir -p "$BLOBDEST/$BLOBBASEFOLDER/$BLOBSUBFOLDER"
      pushd "$STORAGEPATH/$BLOBBASEFOLDER/$BLOBSUBFOLDER" >/dev/null
      FILES=`echo *`
      if [ "$FILES" != "*" ]; then
        ln -f $MYOPTS * "$BLOBDEST/$BLOBBASEFOLDER/$BLOBSUBFOLDER/" 2>&1 | grep -v "File exists"
      fi
      popd >/dev/null
    done

  done

  # remove the suspend file and wait for the backup to finish
  echo "Creating a backup"
  rm -f -- "$BACKUPDEST/backup/suspend"
  # Bring the backup to the foreground, wait for it to finish
  fg %1 > /dev/null
  # See if backup has really finished
  if [ ! -f "$BACKUPDEST/backup/backup.md5" ]; then
    echo "Database backup process failed"
    kill -INT %2
    exit 1
  fi
  sleep 1
  kill -INT %2
else

  # FIXME: make sure no blobs are deleted during the backup

  [ "$VERBOSE" == "1" ] && echo "Making copy of the blobs"
  for BLOBBASEFOLDER in blob ; do
    if [ -d "$STORAGEPATH/$BLOBBASEFOLDER" ]; then
      mkdir -p "$BLOBDEST/$BLOBBASEFOLDER/"
      rsync -av $RSYNCOPTS --link-dest "$STORAGEPATH/" "$STORAGEPATH/$BLOBBASEFOLDER" "$BLOBDEST/"

      RSYNCRETVAL="$?"
      if [ "$RSYNCRETVAL" != "0" ]; then
        echo "First rsync with error code $RSYNCRETVAL"
        exit 1
      fi
    fi
  done

  [ "$VERBOSE" == "1" ] && echo "Make database backup"
  PSROOT="${WEBHARE_DATAROOT}postgresql"
  mkdir -p "$BACKUPDEST/backup/"

  pg_basebackup -D "$BACKUPDEST/backup/" -h "$PSROOT/db" -F tar -P -v -h "$PSROOT" --compress=1
  BACKUPRETVAL="$?"

  if [ "$BACKUPRETVAL" != "0" ]; then
    echo "pg_basebackup failed with errorcode $BACKUPRETVAL"
    exit 1
  fi

  [ "$VERBOSE" == "1" ] && echo "Add new blobs created during database backup"
  for BLOBBASEFOLDER in blob ; do
    if [ -d "$STORAGEPATH/$BLOBBASEFOLDER" ]; then
      mkdir -p "$BLOBDEST/$BLOBBASEFOLDER/"
      rsync -av $RSYNCOPTS --link-dest "$STORAGEPATH/" "$STORAGEPATH/$BLOBBASEFOLDER" "$BLOBDEST/"

      RSYNCRETVAL="$?"
      if [ "$RSYNCRETVAL" != "0" ]; then
        echo "Second rsync with error code $RSYNCRETVAL"
        exit 1
      fi
    fi
  done
fi

echo "Your backup is in $BACKUPDEST/"

#!/bin/bash
# FIXME in the webhare builtin version, we can remove support for 4.08 and WHDB soon

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

echo "STORAGEPATH: $STORAGEPATH"

BACKUPDEST="/opt/whdata/preparedbackup"
rm -rf "$BACKUPDEST"
mkdir -p $BACKUPDEST

echo "BACKUP DESTINATION: $BACKUPDEST"

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

echo "Your backup is in $BACKUPDEST/"

#!/bin/bash

source "$WEBHARE_DIR/lib/wh-functions.sh"
load_postgres_settings

BACKUPDEST="$1"
[ -z "$BACKUPDEST" ] && die "No backup destination"

if [ -f "$BACKUPDEST/dbase/translog.whdb" ] || [ -f "$BACKUPDEST/postgresql/db/postgresql.conf" ]; then
  die "$TARGETDIR already seems to contain a database"
fi

getwhparameters
if [ -z "$WEBHARE_DATABASEPATH" ];then
  die "Failed to retrieve database configuration"
fi

if ! is_webhare_running; then
  die "WebHare must be running for a backup"
fi

echo "STORAGEPATH: $WEBHARE_DATABASEPATH"
echo "BACKUP DESTINATION: $BACKUPDEST"

if [ "$(uname)" == "Darwin" ]; then
  RSYNCOPTS="--progress"
else
  RSYNCOPTS="--info=progress2"
fi

mkdir -p -- "$BACKUPDEST" # creates the target, usually "$WEBHARE_DATAROOT"/preparedbackup

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

# TODO: make sure no blobs are deleted during the backup - this now happens based on timing (blobs aren't deleted for the first few hours) but still contains a race

[ "$VERBOSE" == "1" ] && echo "Making copy of the blobs"
mkdir -p "$BLOBDEST/blob/"
rsync -av $RSYNCOPTS --link-dest "$WEBHARE_DATABASEPATH/" "$WEBHARE_DATABASEPATH/blob" "$BLOBDEST/"

RSYNCRETVAL="$?"
if [ "$RSYNCRETVAL" != "0" ]; then
  echo "First rsync with error code $RSYNCRETVAL"
  exit 1
fi

[ "$VERBOSE" == "1" ] && echo "Make database backup"
PSROOT="${WEBHARE_DATAROOT}postgresql"
mkdir -p "$BACKUPDEST/backup/"

"$WEBHARE_PGBIN/pg_basebackup" -D "$BACKUPDEST/backup/" -F tar -P -v  --compress=1
BACKUPRETVAL="$?"

if [ "$BACKUPRETVAL" != "0" ]; then
  echo "pg_basebackup failed with errorcode $BACKUPRETVAL"
  exit 1
fi

[ "$VERBOSE" == "1" ] && echo "Add new blobs created during database backup"
for BLOBBASEFOLDER in blob ; do
  if [ -d "$WEBHARE_DATABASEPATH/$BLOBBASEFOLDER" ]; then
    mkdir -p "$BLOBDEST/$BLOBBASEFOLDER/"
    rsync -av $RSYNCOPTS --link-dest "$WEBHARE_DATABASEPATH/" "$WEBHARE_DATABASEPATH/$BLOBBASEFOLDER" "$BLOBDEST/"

    RSYNCRETVAL="$?"
    if [ "$RSYNCRETVAL" != "0" ]; then
      echo "Second rsync with error code $RSYNCRETVAL"
      exit 1
    fi
  fi
done

touch $BACKUPDEST/backupcomplete
echo "Your backup is in $BACKUPDEST/"

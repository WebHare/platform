# command: backuplocal
# short: Create a backup of the database

source $WEBHARE_DIR/lib/wh-functions.sh

getwhparameters
if [ -z "$STORAGEPATH" ];then
  echo "Failed to retrieve database configuration"
  exit 1
fi

echo "STORAGEPATH: $STORAGEPATH"
exit 1

BACKUPDEST=`cd $STORAGEPATH ; cd .. ; pwd`/backups/`date +%Y-%m-%dT%H.%M.%S`
mkdir -p $BACKUPDEST

if [ -f "$BACKUPDEST/dbase/translog.whdb" -o -f "$BACKUPDEST/postgresql/db/postgresql.conf" ]; then
  echo "$1 already seems to contain a database, it will be overwritten!"
  echo "Press enter to continue, or CTRL+C to abort now"
  read
fi

mkdir -p "$BACKUPDEST"

rm -rf -- "$BACKUPDEST/dbase" "$BACKUPDEST/postgresql" "$BACKUPDEST/backup" "$BACKUPDEST/blob"
mkdir -p -- "$BACKUPDEST/backup" "$BACKUPDEST/blob"
BLOBDEST="$BACKUPDEST"
if ! is_webhare_running; then
  echo "WebHare must be running for a $INSTR";
  exit 1
fi

# Start job control, needed to start backup in background
set -m
trap control_c SIGINT

if [ "$__WEBHARE_DBASE" == "dbserver" ]; then
  [ "$VERBOSE" == "1" ] && echo "Launching backup process"
  "${WEBHARE_DIR}/bin/backup" -cp --threads --blobmode=reference --suspendfile $BACKUPDEST/backup/suspend $BACKUPDEST/backup/backup > $BACKUPDEST/backuplog 2>&1 &
  tail -n 1000 -f "$BACKUPDEST/backuplog" &

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
elif [ "$__WEBHARE_DBASE" == "postgresql" ]; then

  # FIXME: make sure no blobs are deleted during the backup

  [ "$VERBOSE" == "1" ] && echo "Making copy of the blobs"
  for BLOBBASEFOLDER in blob ` cd $STORAGEPATH ; echo blob-* `; do
    if [ -d "$STORAGEPATH/$BLOBBASEFOLDER" ]; then
      mkdir -p "$BLOBDEST/$BLOBBASEFOLDER/"
      rsync -avH --info=progress2 --link-dest "$STORAGEPATH/" "$STORAGEPATH/$BLOBBASEFOLDER" "$BLOBDEST/"
    fi
  done

  [ "$VERBOSE" == "1" ] && echo "Make database backup"
  PSROOT="${WEBHARE_DATAROOT}postgresql"
  mkdir -p "$BACKUPDEST/backup/"
  echo "pg_basebackup -D $BACKUPDEST/backup/ -F tar -z -P -v -h $PSROOT/db"
  pg_basebackup -D "$BACKUPDEST/backup/" -h "$PSROOT/db" -F tar -P -v -h "$PSROOT" --compress=1

  [ "$VERBOSE" == "1" ] && echo "Add new blobs created during database backup"
  for BLOBBASEFOLDER in blob ` cd $STORAGEPATH ; echo blob-* `; do
    if [ -d "$STORAGEPATH/$BLOBBASEFOLDER" ]; then
      mkdir -p "$BLOBDEST/$BLOBBASEFOLDER/"
      rsync -avH --info=progress2 --link-dest "$STORAGEPATH/" "$STORAGEPATH/$BLOBBASEFOLDER" "$BLOBDEST/"
    fi
  done
else
  echo "Unknown database type $__WEBHARE_DBASE"
  exit 1
fi

echo "Your backup is in $BACKUPDEST/backup/"

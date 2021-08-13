# command: backuplocal
# short: Create a backup of the database

source $WEBHARE_DIR/lib/wh-functions.sh

getwhparameters
if [ -z "$STORAGEPATH" ];then
  die "Failed to retrieve database configuration"
fi

echo "STORAGEPATH: $STORAGEPATH"

BACKUPDEST="$WEBHARE_DATAROOT/backups/$(date +%Y-%m-%dT%H.%M.%S)"
mkdir -p $BACKUPDEST

echo "BACKUP DESTINATION: $BACKUPDEST"

if [ -f "$BACKUPDEST/dbase/translog.whdb" -o -f "$BACKUPDEST/postgresql/db/postgresql.conf" ]; then
  echo "$1 already seems to contain a database, it will be overwritten!"
  echo "Press enter to continue, or CTRL+C to abort now"
  read
fi
rm $BACKUPDEST/backupcomplete 2>/dev/null #cleanup completion marker just in case

if [ "`uname`" == "Darwin" ]; then
  RSYNCOPTS="--progress"
else
  RSYNCOPTS="--info=progress2"
fi

mkdir -p "$BACKUPDEST"

rm -rf -- "$BACKUPDEST/dbase" "$BACKUPDEST/postgresql" "$BACKUPDEST/backup" "$BACKUPDEST/blob"
mkdir -p -- "$BACKUPDEST/backup" "$BACKUPDEST/blob"
BLOBDEST="$BACKUPDEST"
if ! is_webhare_running; then
  die "WebHare must be running for a backup"
fi

function control_c()
{
  echo "SIGINT"
  kill %1
  kill %2
  exit 1
}

if [ "$__WEBHARE_DBASE" == "dbserver" ]; then
  # Start job control, needed to start backup in background
  set -m
  trap control_c SIGINT


  [ "$VERBOSE" == "1" ] && echo "Launching backup process"
  "${WEBHARE_DIR}/bin/backup" -cp --threads --blobmode=reference --suspendfile $BACKUPDEST/backup/suspend $BACKUPDEST/backup/backup > $BACKUPDEST/backuplog 2>&1 &
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
    kill -INT %2
    die "Database backup process failed"
  fi
  sleep 1
  kill -INT %2
elif [ "$__WEBHARE_DBASE" == "postgresql" ]; then

  # FIXME: make sure no blobs are deleted during the backup

  [ "$VERBOSE" == "1" ] && echo "Making copy of the blobs"
  mkdir -p "$BLOBDEST/blob/"
  rsync -av $RSYNCOPTS --link-dest "$STORAGEPATH/" "$STORAGEPATH/blob" "$BLOBDEST/"

  RSYNCRETVAL="$?"
  if [ "$RSYNCRETVAL" != "0" ]; then
    die "First rsync with error code $RSYNCRETVAL"
  fi

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
  rsync -av $RSYNCOPTS --link-dest "$STORAGEPATH/" "$STORAGEPATH/blob" "$BLOBDEST/"

  RSYNCRETVAL="$?"
  if [ "$RSYNCRETVAL" != "0" ]; then
    die "Second rsync with error code $RSYNCRETVAL"
  fi
else
  die "Unknown database type $__WEBHARE_DBASE"
fi

touch $BACKUPDEST/backupcomplete
echo "Your backup is in $BACKUPDEST/"

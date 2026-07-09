#!/bin/bash

source "${BASH_SOURCE%/*}/../../../../lib/postgres-functions.sh"
load_postgres_settings
set -eo pipefail

BACKUPDEST="$1"
[ -z "$BACKUPDEST" ] && die "No backup destination"
shift

if [ "$1" == "--verbose" ]; then
  VERBOSE="1"
  shift
fi

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

logWithTime "Backup from $WEBHARE_DATABASEPATH to $BACKUPDEST"

mkdir -p -- "$BACKUPDEST" # creates the target, usually "$WEBHARE_DATAROOT"/preparedbackup
BACKUPDEST=$(cd "$BACKUPDEST" && pwd) #make it an absolute path

[ -n "$VERBOSE" ] && logWithTime "Removing any previous backup"
rm -rf -- "$BACKUPDEST/dbase" "$BACKUPDEST/postgresql" "$BACKUPDEST/backup" "$BACKUPDEST/blob"

[ -n "$VERBOSE" ] && logWithTime "Setting up new backup folders"
mkdir -p -- "$BACKUPDEST/backup" "$BACKUPDEST/blob"
BLOBDEST="$BACKUPDEST"

function control_c()
{
  echo "SIGINT"
  kill %1
  kill %2
  exit 1
}

function sync_blobs()
{
  mkdir -p "$BLOBDEST/blob/"

  if [ "$(uname)" == "Darwin" ]; then
    # we have xargs -J (not on Linux/GNU!)
    DIRS=( $(cd "$WEBHARE_DATABASEPATH/blob" ; echo ??) )
    TOTALDIRS="${#DIRS[@]}"
    DONE=0

    for DIR in "${DIRS[@]}"; do
      DONE=$((DONE + 1))
      [ "$VERBOSE" == "1" ] && logWithTime "Syncing blob directory $DIR ($DONE/$TOTALDIRS)"

      mkdir -p "$BLOBDEST/blob/$DIR"

      # shellcheck disable=SC2012
      ( cd "$BLOBDEST/blob/$DIR/" ; ls | sort ) > "$BLOBDEST/.destfiles"
      (
        cd "$WEBHARE_DATABASEPATH/blob/$DIR"
        # shellcheck disable=SC2012
        ls | sort > "$BLOBDEST/.sourcefiles"

        # take the files only in the source directory, link them too
        comm -2 -3 "$BLOBDEST/.sourcefiles" "$BLOBDEST/.destfiles" | xargs -J% -n 100 ln % "$BLOBDEST/blob/$DIR/"
      )
    done
  else
    # we have cp --recursive --link here (not on Darwin)
    # --no-clobber prevents overwriting existing files which should save some time (either the way the blobs are immutable)
    cp --recursive --link --no-clobber "$WEBHARE_DATABASEPATH/blob"/* "$BLOBDEST/blob/"
  fi
}

# TODO: make sure no blobs are deleted during the backup - this now happens based on timing (blobs aren't deleted for the first few hours) but still contains a race
[ "$VERBOSE" == "1" ] && logWithTime "Linking blobs"
sync_blobs

[ "$VERBOSE" == "1" ] && logWithTime "Make database backup"
PSROOT="${WEBHARE_DATAROOT}postgresql"
mkdir -p "$BACKUPDEST/backup/"

"$WEBHARE_PGBIN/pg_basebackup" -D "$BACKUPDEST/backup/" -F tar -P -v  --compress=1
BACKUPRETVAL="$?"

if [ "$BACKUPRETVAL" != "0" ]; then
  echo "pg_basebackup failed with errorcode $BACKUPRETVAL"
  exit 1
fi

[ "$VERBOSE" == "1" ] && logWithTime "Add new blobs created during database backup"
sync_blobs

touch "$BACKUPDEST/backupcomplete"
logWithTime "Backup prepared, your backup is in $BACKUPDEST/"

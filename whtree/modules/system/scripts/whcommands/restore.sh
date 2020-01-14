source $WEBHARE_DIR/lib/wh-functions.sh

BLOBIMPORTMODE="hardlink"

while true; do
  if [ "$1" == "--webhareimage" ]; then
    if [ -n "$WEBHARE_IN_DOCKER" ]; then
      echo "Cannot pass --webhareimage if we're already running inside Docker"
      exit 1
    fi
    shift
    WEBHAREIMAGE="$1"
    shift
  elif [ "$1" == "--copy" ]; then
    BLOBIMPORTMODE="copy"
    shift
  elif [ "$1" == "--softlink" ]; then
    BLOBIMPORTMODE="softlink"
    shift
  elif [[ $1 =~ ^- ]]; then
    echo "Illegal option '$1'"
    exit 1
  else
    break
  fi
done

if [ -z "$1" ]; then
  echo "Syntax: wh restore [ --softlink ] [ --copy ] [ --webhareimage image ] <srcdir>"
  echo "  --softlink:     softlink blobs, don't try to hardlink"
  echo "  --copy:         copy blobs, don't try to hardlink"
  echo "  --webhareimage: use docker to restore. full docker image name or just a version, eg 4.19"
  exit 1
fi
if [ "$BLOBIMPORTMODE" == "softlink" -a -n "$WEBHAREIMAGE" ]; then
  echo "Cannot use softlinks for docker-based restores. If you need softlinked backups inside a docker, move the data into "
  echo "the container's /opt/whdata first, and run 'wh restore --softlink' inside the container"
  exit 1
fi

TORESTORE="$1"

if [[ "$WEBHAREIMAGE" =~ ^[0-9]+\.[0-9]+$ ]]; then
  WEBHAREIMAGE="webhare/webhare-core:$WEBHAREIMAGE"
fi

if [ "`uname`" == "Darwin" ]; then
  RSYNCOPTS="--progress"
else
  RSYNCOPTS="--info=progress2"
fi


if [ ! -d "$TORESTORE" ] ; then
  echo "$TORESTORE is not a directory"
  exit 1
fi

# ADDME Support other restore formats, eg full backup files without blobs (no easy way to recognize them from outside though? just assume if there's no blob folder ?)
if [ -f "$TORESTORE/backup/backup.bk000" ] ; then
  RESTORE_DB=dbserver
elif [ -f "$TORESTORE/backup/base.tar.gz" ] ; then
  RESTORE_DB=postgresql
else
  echo "Cannot find $TORESTORE/backup/base.tar.gz or $TORESTORE/backup/backup.bk000"
  exit 1
fi



if [ ! -d "$TORESTORE/blob" ]; then
  echo "$TORESTORE/blob does not exist"
  exit 1
fi

if [ "$RESTORE_DB" == "dbserver" -a -d "$WEBHARE_DATAROOT/dbase" ]; then
  echo "$WEBHARE_DATAROOT/dbase already exists - did you mean to specify a different WEBHARE_DATAROOT for the restore?"
  exit 1
elif [ "$RESTORE_DB" == "postgresql" -a -d "$WEBHARE_DATAROOT/postgresql" ]; then
  echo "$WEBHARE_DATAROOT/postgresql already exists - did you mean to specify a different WEBHARE_DATAROOT for the restore?"
  exit 1
fi

mkdir -p "$WEBHARE_DATAROOT" 2>/dev/null
if [ ! -d "$WEBHARE_DATAROOT" ]; then
  echo "Unable to create $WEBHARE_DATAROOT"
  exit 1
fi

if [ -n "$WEBHAREIMAGE" ]; then
  # We'll be using the specified docker image to do the restore. This will not work with pre-4.20 images
  # We'll force --copy - if you're doing rescue-type restores inside a docker container (with the dbase in /opt/whdata/restore)
  #                      just invoke wh restore inside that docker.
  exec docker run -ti --rm -v "$WEBHARE_DATAROOT":/opt/whdata -v "$TORESTORE":/backupsource $WEBHAREIMAGE wh restore --copy /backupsource/
  exit 255
fi

if [ -z "$WEBHARE_IN_DOCKER" ]; then
  if [ -z "$WEBHARE_BASEPORT" -o "$WEBHARE_BASEPORT" == "13679" ]; then #If you've explicitly set a port, honor that, otherwise generate one
    WEBHARE_BASEPORT=$(( $RANDOM / 10 * 10 + 20000))
  fi

  cat > "$WEBHARE_DATAROOT/settings.sh" << EOF
export WEBHARE_ISRESTORED=1
export WEBHARE_BASEPORT=$WEBHARE_BASEPORT
EOF
fi

if [ "$RESTORE_DB" == "dbserver" ]; then
  if ! $WEBHARE_DIR/bin/dbserver --restore "$TORESTORE/backup/backup.bk000" --restoreto "$WEBHARE_DATAROOT/dbase" --blobimportmode $BLOBIMPORTMODE ; then
    echo "Restore failed (errorcode $?)"
    exit $?
  fi
elif [ "$RESTORE_DB" == "postgresql" ]; then
  # Remove previous restore
  rm -rf "$WEBHARE_DATAROOT/postgresql.restore/"

  mkdir -p "$WEBHARE_DATAROOT/postgresql.restore/db/pg_wal/"
  chmod -R 700 "$WEBHARE_DATAROOT/postgresql.restore/db/"

  PV="cat"
  which pv >/dev/null 2>&1 && PV="pv"

  if ! $PV "$TORESTORE/backup/base.tar.gz" | (umask 0077 && tar zx --no-same-permissions -C "$WEBHARE_DATAROOT/postgresql.restore/db/"); then
    echo Extracting base database failed
    exit 1
  fi
  if ! $PV "$TORESTORE/backup/pg_wal.tar.gz" | (umask 0077 && tar zx --no-same-permissions -C "$WEBHARE_DATAROOT/postgresql.restore/db/pg_wal/"); then
    echo Extracting WAL segments failed
    exit 1
  fi

  if [ "$BLOBIMPORTMODE" == "softlink" ]; then
    if ! cp -rs "$TORESTORE/blob" "$WEBHARE_DATAROOT/postgresql.restore/"; then
      echo Softlinking blobs failed
      exit 1
    fi
  else
    LINKARG=()
    if [ "$BLOBIMPORTMODE" == "hardlink" ]; then
      LINKARG+=(--link-dest=$TORESTORE/)
    fi

    if ! rsync -a $RSYNCOPTS "${LINKARG[@]}" "$TORESTORE/blob" "$WEBHARE_DATAROOT/postgresql.restore/"; then
      echo Extracting blobs failed
      exit 1
    fi
  fi

  if [ -n "$WEBHARE_IN_DOCKER" ]; then
    chown -R postgres:root "$WEBHARE_DATAROOT/postgresql.restore/"
  fi
  mv "$WEBHARE_DATAROOT/postgresql.restore" "$WEBHARE_DATAROOT/postgresql"
fi

echo ""
echo "Restore complete!"

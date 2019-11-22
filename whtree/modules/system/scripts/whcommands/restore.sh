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

if [ ! -d "$TORESTORE" ] ; then
  echo "$TORESTORE is not a directory"
  exit 1
fi
# ADDME Support other restore formats, eg full backup files without blobs (no easy way to recognize them from outside though? just assume if there's no blob folder ?)
if [ ! -f "$TORESTORE/backup/backup.bk000" ] ; then
  echo "Cannot find $TORESTORE/backup/backup.bk000"
  exit 1
fi
if [ ! -d "$TORESTORE/blob" ]; then
  echo "$TORESTORE/blob does not exist"
  exit 1
fi

if [ -d "$WEBHARE_DATAROOT/dbase" ]; then
  echo "$WEBHARE_DATAROOT/dbase already exists - did you mean to specify a different WEBHARE_DATAROOT for the restore?"
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
  exec docker run --rm -v "$WEBHARE_DATAROOT":/opt/whdata -v "$TORESTORE":/backupsource $WEBHAREIMAGE wh restore --copy /backupsource/
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

if ! $WEBHARE_DIR/bin/dbserver --restore "$TORESTORE/backup/backup.bk000" --restoreto "$WEBHARE_DATAROOT/dbase" --blobimportmode $BLOBIMPORTMODE ; then
  echo "Restore failed (errorcode $?)"
  exit $?
fi

echo ""
echo "Restore complete!"

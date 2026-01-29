#!/bin/bash
# TODO use nproc or `sysctl -n hw.logicalcpu` instead of relying on the old buildj calculation
#
# This script will
#  - set webhare to readonly mode
#  - dump the current database to ${WEBHARE_DATAROOT}/postgresql/dump.current
#  - create a new database out of that dump in ${WEBHARE_DATAROOT}/postgresql/db.recreated
#  - rename db.recreated to db.switchto (to mark the switch as ready-to-switch-to)
#  - restart the database server to do the actual switch

source "${BASH_SOURCE%/*}/../../../../lib/postgres-functions.sh"
load_postgres_settings
set -e

estimate_buildj

NOMODE=""
NEWBINDIR=""
DRYRUN=""

while [[ -n "$1" ]]; do
  if [ "$1" == "--nosetserver" ]; then
    echo "Not changing server types or restarting databases"
    shift
    NOMODE=1
  elif [ "$1" == "--set-version" ]; then
    shift
    SETVERSION="$1"
    shift
    get_postgres_binaries NEWBINDIR "$SETVERSION"
  elif [ "$1" == "--new-bindir" ]; then
    shift
    NEWBINDIR="$1"
    shift
  elif [ "$1" == "--dry-run" ]; then
    shift
    DRYRUN=1
    NOMODE=1
  else
    echo "Syntax: wh dump-postgresql-database [--nosetserver] [--new-version <version>] [--new-bindir <path>] [--dry-run]"
    exit 1
  fi
done

[ -z "$WEBHARE_DBASENAME" ] && die "WEBHARE_DBASENAME not set"

[ -z "$WEBHARE_DATAROOT" ] && die "WEBHARE_DATAROOT not set"
[ -z "$PGHOST" ] && die "PGHOST is not set"
[ -z "$PGPORT" ] && die "PGPORT is not set"
[ -z "$PGUSER" ] && die "PGUSER is not set"

DUMP_DIR="${WEBHARE_DATAROOT}/postgresql/dump.current"
RECREATE_DIR="${WEBHARE_DATAROOT}/postgresql/db.recreated"
SWITCHTO_DIR="${WEBHARE_DATAROOT}/postgresql/db.switchto"
RECREATE_PORT="$(( $PGPORT + 1 ))"

if [ -d "$SWITCHTO_DIR" ]; then
  echo "$SWITCHTO_DIR exists. Delete to abort current migration"
  exit 1
fi

if [ -n "$NEWBINDIR" ];  then
  if [ ! -x "$NEWBINDIR/postgres" ]; then
    echo "Could not find PostgreSQL binaries in $NEWBINDIR"
    exit 1
  fi
else
  NEWBINDIR="$WEBHARE_PGBIN"
fi

# Check expected environment (in case other scripts are changing and forgetting about us)
[ -z "${PSROOT}" ] && echo "PSROOT not set" >&2 && exit 1
[ ! -d "${PSROOT}/db" ] && echo "No existing database found in ${PSROOT}/db " >&2 && exit 1

cd /
rm -rf -- "${RECREATE_DIR}" "${DUMP_DIR}"

if [ -z "$NOMODE" ]; then
  wh debug enable db-readonly
fi

function cleanup()
{
  if [ -n "$POSTMASTER_PID" ]; then
    POSTMASTER_PID=""
    $RUNAS "$NEWBINDIR/pg_ctl" -D "${RECREATE_DIR}" -m fast stop
  fi
}
trap cleanup EXIT SIGINT

logWithTime "Dumping database (using $WHBUILD_NUMPROC threads)"

$RUNAS "$WEBHARE_PGBIN/pg_dump" -j "$WHBUILD_NUMPROC" -f "${DUMP_DIR}" --format=d -v webhare
ERRORCODE="$?"
if [ "$ERRORCODE" != "0" ]; then
  echo "pg_dump failed with errorcode $ERRORCODE"
  exit $ERRORCODE
fi

# Dump global settings (roles and tablespaces though we don't use the latter yet?)
$RUNAS "$WEBHARE_PGBIN/pg_dumpall" -f "${DUMP_DIR}/pg-globals.sql" --globals-only
ERRORCODE="$?"
if [ "$ERRORCODE" != "0" ]; then
  echo "pg_dumpall failed with errorcode $ERRORCODE"
  exit $ERRORCODE
fi

logWithTime "Creating new database cluster in ${RECREATE_DIR} using binaries from $NEWBINDIR"
init_webhare_pg_db "$RECREATE_DIR" "$NEWBINDIR"

[ -f "${PSROOT}/db/server.key" ] && cp -v "${PSROOT}/db/server".* "${RECREATE_DIR}/"

pushd "${WEBHARE_DIR}/etc/" # this allows PG when running to find the pg_hba-XXX.conf file
$RUNAS "$NEWBINDIR/postgres" -c "listen_addresses=" -c "unix_socket_directories=$PGHOST" -c "port=$RECREATE_PORT" -c "ssl=off" -D "${RECREATE_DIR}" &
POSTMASTER_PID=$!
popd

NEWDBOPTIONS=(-d "$WEBHARE_DBASENAME" -p "$RECREATE_PORT")

until "$NEWBINDIR/psql" "${NEWDBOPTIONS[@]}" -c '\q' 2>/dev/null ; do
  >&2 echo "Postgres is unavailable - sleeping"
  sleep .2
done

RESTOREOPTIONS=""
if [ "$WEBHARE_PLATFORM" = "darwin" ]; then
  RESTOREOPTIONS="--no-owner"
fi

ERRORCODE=0

logWithTime "Restoring database into new cluster"
# Replay global settings
$RUNAS "$NEWBINDIR/psql" "${NEWDBOPTIONS[@]}" -X -f "${DUMP_DIR}/pg-globals.sql" || ERRORCODE="$?"
if [ "$ERRORCODE" != "0" ]; then
  echo "psql globals failed with errorcode $ERRORCODE"
  exit $ERRORCODE
fi

# This interferes with the dump. bootstrap.ts#ensureSettings will fix it when Webhare actually starts
$RUNAS "$NEWBINDIR/psql" "${NEWDBOPTIONS[@]}" -X -c "START TRANSACTION READ WRITE;; alter user current_user set default_transaction_read_only = off; commit;" || ERRORCODE="$?"
if [ "$ERRORCODE" != "0" ]; then
  echo "psql globals failed with errorcode $ERRORCODE"
  exit $ERRORCODE
fi

$RUNAS "$NEWBINDIR/pg_restore" "${NEWDBOPTIONS[@]}" $RESTOREOPTIONS -j "$WHBUILD_NUMPROC" --format=d -v "${DUMP_DIR}" || ERRORCODE="$?"
if [ "$ERRORCODE" != "0" ]; then
  echo "restore failed with errorcode $ERRORCODE"
  exit $ERRORCODE
fi

POSTMASTER_PID=""
$RUNAS "$WEBHARE_PGBIN/pg_ctl" -D "${RECREATE_DIR}" -m fast stop

logWithTime "Restore complete"

if [ -n "$DRYRUN" ]; then
  echo "dry run mode - not switching databases. Cleaning up the dry-run dump"
  rm -rf -- "${RECREATE_DIR}" "${DUMP_DIR}"
  exit 0
fi

# prepare for in place-move
mv "${RECREATE_DIR}" "$SWITCHTO_DIR"

# delete old dump in the background
TEMPNAME="${DUMP_DIR}.$$"
mv "${DUMP_DIR}" "$TEMPNAME"
rm -rf -- "$TEMPNAME" &
disown # killing us won't kill the rm


if [ -z "$NOMODE" ]; then
  logWithTime "Restarting WebHare"
  # To be honest - it's safer to restart all of WebHare. See also https://gitlab.webhare.com/webharebv/codekloppers/-/issues/200
   wh service relaunch
fi

exit 0

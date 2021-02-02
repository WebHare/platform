estimate_buildj
NOMODE=""

while [[ -n "$1" ]]; do
  if [ "$1" == "--nosetserver" ]; then
    echo "Not changing server types or restarting databases"
    shift
    NOMODE=1
  else
    echo "Syntax: wh recreate-postgresql-database [--nosetserver]"
    exit 1
  fi
  shift
done

if [ -d ${WEBHARE_DATAROOT}/postgresql/db.switchto ]; then
  echo "${WEBHARE_DATAROOT}/postgresql/db.switchto exists. Delete to abort current migration"
  exit 1
fi

if [ -n "$WEBHARE_IN_DOCKER" ]; then
  RUNAS="chpst -u postgres:whdata"
  PSBIN="/usr/lib/postgresql/11/bin/"
elif [ "$WHBUILD_PLATFORM" = "darwin" ]; then
  PSBIN="$(brew --prefix)/bin/"
else
  PSBIN="/usr/pgsql-11/bin/"
fi

cd /
rm -rf ${WEBHARE_DATAROOT}/postgresql/db.localefix ${WEBHARE_DATAROOT}/postgresql/localefix.dump

if [ -z "$NOMODE" ]; then
  wh db setserver readonly
fi

function cleanup()
{
  if [ -n "$POSTMASTER_PID" ]; then
    POSTMASTER_PID=""
    $RUNAS $PSBIN/pg_ctl -D ${WEBHARE_DATAROOT}/postgresql/db.localefix -m fast stop
  fi
  exit 1
}
trap cleanup EXIT SIGINT

echo "Will dump/restore using $WHBUILD_NUMPROC threads"
if ! $RUNAS $PSBIN/pg_dump --host ${WEBHARE_DATAROOT}/postgresql/ -j $WHBUILD_NUMPROC -f ${WEBHARE_DATAROOT}/postgresql/localefix.dump --format=d -v webhare ; then
  echo "pg_dump failed with errorcode $?"
  exit 1
fi

mkdir ${WEBHARE_DATAROOT}/postgresql/db.localefix
if [ -n "$WEBHARE_IN_DOCKER" ]; then
  chown -R postgres:whdata ${WEBHARE_DATAROOT}/postgresql/db.localefix
fi

$RUNAS $PSBIN/initdb -D ${WEBHARE_DATAROOT}/postgresql/db.localefix --auth-local=trust --encoding "UTF-8" --locale=C -U postgres
cp $WEBHARE_DIR/etc/initial_postgresql.conf ${WEBHARE_DATAROOT}/postgresql/db.localefix/postgresql.conf

$RUNAS $PSBIN/postmaster -p 7777 -D ${WEBHARE_DATAROOT}/postgresql/db.localefix &
POSTMASTER_PID=$!

until $PSBIN/psql -p 7777 --host ${WEBHARE_DATAROOT}/postgresql/ -U postgres -c '\q' 2>/dev/null ; do
  >&2 echo "Postgres is unavailable - sleeping"
  sleep .2
done

export PGOPTIONS="-c default_transaction_read_only=off"
$PSBIN/psql -p 7777 --host ${WEBHARE_DATAROOT}/postgresql/ -U postgres << HERE
CREATE DATABASE webhare;
CREATE USER root;
ALTER USER root WITH SUPERUSER;
GRANT ALL ON DATABASE "webhare" TO root;
GRANT SELECT ON ALL TABLES IN SCHEMA pg_catalog TO root;
GRANT SELECT ON ALL TABLES IN SCHEMA information_schema TO root;
HERE

export PGOPTIONS="-c default_transaction_read_only=off"
if ! $RUNAS env PGOPTIONS="-c default_transaction_read_only=off" $PSBIN/pg_restore -p 7777 --host ${WEBHARE_DATAROOT}/postgresql/ -j $WHBUILD_NUMPROC --format=d -v -d webhare ${WEBHARE_DATAROOT}/postgresql/localefix.dump ; then
  ERRORCODE=$?
  echo "Restore failed with error code $ERRORCODE"
  exit $ERRORCODE
fi

POSTMASTER_PID=""
$RUNAS $PSBIN/pg_ctl -D ${WEBHARE_DATAROOT}/postgresql/db.localefix -m fast stop

# prepare for in place-move
mv ${WEBHARE_DATAROOT}/postgresql/db.localefix ${WEBHARE_DATAROOT}/postgresql/db.switchto

# delete old dump in the background
TEMPNAME="${WEBHARE_DATAROOT}/postgresql/localefix.dump.$$"

mv ${WEBHARE_DATAROOT}/postgresql/localefix.dump $TEMPNAME
rm -rf $TEMPNAME &
disown

if [ -z "$NOMODE" ]; then
  # restart the database server
  if [ -n "$WEBHARE_IN_DOCKER" ]; then
    sv restart webhare #only restarting webhare is currently safe until at least until https://gitlab.webhare.com/webharebv/codekloppers/-/issues/200 is fixed
  else
    $RUNAS $PSBIN/pg_ctl -D ${WEBHARE_DATAROOT}/postgresql/db -m fast stop
    wh db setserver readwrite
  fi
fi

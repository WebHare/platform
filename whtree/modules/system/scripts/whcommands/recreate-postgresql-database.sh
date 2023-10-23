#!/bin/bash
# TODO use nproc or `sysctl -n hw.logicalcpu` instead of relying on the old buildj calculation

estimate_buildj() #local copy so the original can move into the buildtree
{
  if [ -n "$WHBUILD_NUMPROC" ]; then
    return
  fi

  if [ "$WEBHARE_PLATFORM" == "darwin" ]; then
    WHBUILD_NUMPROC=$(( `sysctl hw.ncpu | cut -d":" -f2` + 1 ))
  elif [ "$WEBHARE_PLATFORM" == "linux" ]; then
    WHBUILD_NUMPROC=`LANG=en_US.utf8 lscpu 2>/dev/null | grep "^CPU(s):" | cut -d: -f2` #2>/dev/null because centos 5 util-linux does not include lscpu
    MAXPROC=$(( `cat /proc/meminfo | grep ^MemTotal | cut -b10-24` / 1024000 ))
    if [ -z "$WHBUILD_NUMPROC" ]; then
      WHBUILD_NUMPROC=4
    elif [ $WHBUILD_NUMPROC -gt $MAXPROC ]; then
      WHBUILD_NUMPROC=$MAXPROC
    fi
  else
    echo "Unable to estimate proper build flags"
    exit 1
  fi
}


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
elif [ "$WEBHARE_PLATFORM" = "darwin" ]; then
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
$RUNAS $PSBIN/pg_dump --host ${WEBHARE_DATAROOT}/postgresql/ -j $WHBUILD_NUMPROC -f ${WEBHARE_DATAROOT}/postgresql/localefix.dump --format=d -v webhare
ERRORCODE="$?"
if [ "$ERRORCODE" != "0" ]; then
  echo "pg_dump failed with errorcode $ERRORCODE"
  exit $ERRORCODE
fi

mkdir ${WEBHARE_DATAROOT}/postgresql/db.localefix
if [ -n "$WEBHARE_IN_DOCKER" ]; then
  chown -R postgres:whdata ${WEBHARE_DATAROOT}/postgresql/db.localefix
fi

$RUNAS $PSBIN/initdb -D ${WEBHARE_DATAROOT}/postgresql/db.localefix --auth-local=trust --encoding "UTF-8" --locale=C -U postgres
cp $WEBHARE_DIR/etc/postgresql.conf ${WEBHARE_DATAROOT}/postgresql/db.localefix/postgresql.conf

$RUNAS $PSBIN/postmaster -p 7777 -D ${WEBHARE_DATAROOT}/postgresql/db.localefix &
POSTMASTER_PID=$!

until $PSBIN/psql -p 7777 --host ${WEBHARE_DATAROOT}/postgresql/ -U postgres -c '\q' 2>/dev/null ; do
  >&2 echo "Postgres is unavailable - sleeping"
  sleep .2
done

$PSBIN/psql -p 7777 --host ${WEBHARE_DATAROOT}/postgresql/ -U postgres << HERE
CREATE DATABASE webhare;
CREATE USER root;
ALTER USER root WITH SUPERUSER;
GRANT ALL ON DATABASE "webhare" TO root;
GRANT SELECT ON ALL TABLES IN SCHEMA pg_catalog TO root;
GRANT SELECT ON ALL TABLES IN SCHEMA information_schema TO root;
HERE

RESTOREOPTIONS=""
if [ "$WEBHARE_PLATFORM" = "darwin" ]; then
  RESTOREOPTIONS="--no-owner"
fi

$RUNAS $PSBIN/pg_restore $RESTOREOPTIONS -p 7777 --host ${WEBHARE_DATAROOT}/postgresql/ -j $WHBUILD_NUMPROC --format=d -v -d webhare ${WEBHARE_DATAROOT}/postgresql/localefix.dump
ERRORCODE="$?"
if [ "$ERRORCODE" != "0" ]; then
  echo "restore failed with errorcode $ERRORCODE"
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

#!/bin/bash
rm $WEBHARE_DATAROOT/.dbserver.pid 2>/dev/null

if [ "$__WEBHARE_DBASE" == "dbserver" ]; then
  echo "Starting database server"
  echo $$ > $WEBHARE_DATAROOT/.dbserver.pid
  exec ${BASH_SOURCE%/*}/dbserver --listen 127.0.0.1:$WEBHARE_BASEPORT --dbasefolder $WEBHARE_DATAROOT/dbase #forward to classic dbserver
fi

# Let's start (and setup?) PostgreSQL!
if [ -z "$WEBHARE_DBASENAME" ]; then
  echo "WEBHARE_DBASENAME name not set"
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

# We put everything under a postgresql folder, so we can chown that to ourselves in the future
eval `$WEBHARE_DIR/bin/webhare printparameters`
PSROOT="${WEBHARE_DATAROOT}postgresql"

ARGS=""

if [ -n "$WEBHARE_POSTGRESQL_MIGRATION" ]; then
  echo "Starting for migration"
  if [ -d "$PSROOT" ]; then
    echo "Existing PostgreSQL database found, refusing to migrate"
    exit 1
  fi
  PSROOT="${WEBHARE_DATAROOT}postgresql-migration"

  # remove previous migrate attempt
  if [ -d "$PSROOT" ]; then
    echo "Removing previous migration attempt in $PSROOT"
    rm -rf "$PSROOT"
  fi

  # Don't need that much WAL for migrating, there is no resumption anyway
  # fsync can be disabled too, a single sync after migration should suffice
  ARGS="-c wal_level=minimal -c fsync=off"
fi

mkdir -p "$PSROOT"

if [ ! -d "$PSROOT/db" ]; then

  # remove previous initialization attempt
  if [ -d "$PSROOT/tmp_initdb" ]; then
    echo "Removing previous initialization attempt in $PSROOT/tmp_initdb"
    rm -rf "$PSROOT/tmp_initdb"
  fi

  mkdir $PSROOT/tmp_initdb/

  if [ -n "$WEBHARE_IN_DOCKER" ]; then
    chown postgres $PSROOT $PSROOT/tmp_initdb
  fi

  echo "Prepare PostgreSQL database in $PSROOT"
  if ! $RUNAS $PSBIN/initdb -U postgres -D $PSROOT/tmp_initdb --auth-local=trust --encoding 'UTF-8' --locale='C' ; then
    echo DB initdb failed
    exit 1
  fi

  # Set the configuration file
  cp "$WEBHARE_DIR/etc/initial_postgresql.conf" "$PSROOT/tmp_initdb/postgresql.conf"

  # CREATE DATABASE cannot be combined with other commands
  # log in to 'postgres' database so we can create our own
  if ! echo "CREATE DATABASE \"$WEBHARE_DBASENAME\";" | $RUNAS $PSBIN/postgres --single -D "$PSROOT/tmp_initdb" -c "default_transaction_read_only=off" postgres ; then
    echo DB create db failed
    exit 1
  fi
  if ! echo "CREATE USER root;ALTER USER root WITH SUPERUSER;GRANT ALL ON DATABASE \"$WEBHARE_DBASENAME\" TO root;" | $RUNAS $PSBIN/postgres --single -D "$PSROOT/tmp_initdb"  -c "default_transaction_read_only=off" $WEBHARE_DBASENAME ; then
    echo DB create user failed
    exit 1
  fi
  if [ -n "$WEBHARE_IN_DOCKER" ]; then
    if ! echo "GRANT SELECT ON ALL TABLES IN SCHEMA pg_catalog TO root;GRANT SELECT ON ALL TABLES IN SCHEMA information_schema TO root;" | $RUNAS $PSBIN/postgres --single -D "$PSROOT/tmp_initdb"  -c "default_transaction_read_only=off" $WEBHARE_DBASENAME ; then
      echo DB adding rights failed
      exit 1
    fi
  fi

  mv $PSROOT/tmp_initdb/ $PSROOT/db/
else

  if [ -d "$PSROOT/db.switchto" ]; then
    echo "Switching to NEW postgresql database!"
    mv "$PSROOT/db" "$PSROOT/db.bak.$(date +%Y%m%dT%H%M%S)"
    mv "$PSROOT/db.switchto" "$PSROOT/db"
  fi

  # Ensure configuration file is set
  cp "$WEBHARE_DIR/etc/initial_postgresql.conf" "$PSROOT/db/postgresql.conf"
fi

echo "Starting PostgreSQL"
echo $$ > $WEBHARE_DATAROOT/.dbserver.pid
exec $RUNAS $PSBIN/postmaster -D "$PSROOT/db" 2>&1

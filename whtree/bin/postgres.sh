#!/bin/bash

source "$WEBHARE_DIR/lib/wh-functions.sh"
load_postgres_settings

cd "${BASH_SOURCE%/*}/../etc/"
if [ -z "$WEBHARE_PGCONFIGFILE" ]; then
  if [ -n "$WEBHARE_IN_DOCKER" ]; then
    WEBHARE_PGCONFIGFILE="${BASH_SOURCE%/*}/../etc/postgresql-docker.conf"
  else
    WEBHARE_PGCONFIGFILE="${BASH_SOURCE%/*}/../etc/postgresql-sourceinstall.conf"
  fi
fi

mkdir -p "$PSROOT"

if [ -n "$WEBHARE_IN_DOCKER" ]; then
  mkdir -p /opt/wh/whtree/currentinstall/pg/
  chown postgres:root /opt/wh/whtree/currentinstall/pg/
fi

function generateConfigFile()
{
  echo "include '$WEBHARE_PGCONFIGFILE'"
  # include_if_exists generates noise if the file doesn't exist
  if [ -f "$WEBHARE_DATAROOT/etc/postgresql-custom.conf" ]; then
    echo "include '$WEBHARE_DATAROOT/etc/postgresql-custom.conf'"
  fi
}

if [ ! -d "$PSROOT/db" ]; then

  # remove previous initialization attempt
  if [ -d "$PSROOT/tmp_initdb" ]; then
    echo "Removing previous initialization attempt in $PSROOT/tmp_initdb"
    rm -rf "$PSROOT/tmp_initdb"
  fi

  mkdir "$PSROOT/tmp_initdb/"

  if [ -n "$WEBHARE_IN_DOCKER" ]; then
    chown postgres "$PSROOT" "$PSROOT/tmp_initdb"
  fi

  echo "Prepare PostgreSQL database in $PSROOT"
  if ! $RUNAS $WEBHARE_PGBIN/initdb -U postgres -D "$PSROOT/tmp_initdb" --auth-local=trust --encoding 'UTF-8' --locale='C' ; then
    echo DB initdb failed
    exit 1
  fi

  # Set the configuration file
  generateConfigFile > "$PSROOT/tmp_initdb/postgresql.conf"

  # CREATE DATABASE cannot be combined with other commands
  # log in to 'postgres' database so we can create our own
  if ! echo "CREATE DATABASE \"$WEBHARE_DBASENAME\";" | $RUNAS $WEBHARE_PGBIN/postgres --single -D "$PSROOT/tmp_initdb" postgres ; then
    echo DB create db failed
    exit 1
  fi
  DOCKERGRANTS=
  if [ -n "$WEBHARE_IN_DOCKER" ]; then
    DOCKERGRANTS="GRANT SELECT ON ALL TABLES IN SCHEMA pg_catalog TO root;GRANT SELECT ON ALL TABLES IN SCHEMA information_schema TO root;"
  fi
  if ! echo "CREATE USER root;ALTER USER root WITH SUPERUSER;GRANT ALL ON DATABASE \"$WEBHARE_DBASENAME\" TO root;$DOCKERGRANTS" | $RUNAS $WEBHARE_PGBIN/postgres --single -D "$PSROOT/tmp_initdb" "$WEBHARE_DBASENAME" ; then
    echo DB create user failed
    exit 1
  fi
  mv "$PSROOT/tmp_initdb/" "$PSROOT/db/"
else

  if [ -d "$PSROOT/db.switchto" ]; then
    echo "Switching to NEW postgresql database!"
    mv "$PSROOT/db" "$PSROOT/db.bak.$(date +%Y%m%dT%H%M%S)"
    mv "$PSROOT/db.switchto" "$PSROOT/db"
  fi

  generateConfigFile > "$PSROOT/db/postgresql.conf"

  if [ -f "$PSROOT/db/pg_hba.conf" ]; then
    # previous webhares created this file, remove it because it is now unused
    rm -f "$PSROOT/db/pg_hba.conf"
  fi
fi


echo "Starting PostgreSQL"
exec $RUNAS "$WEBHARE_PGBIN/postmaster" -D "$PSROOT/db" 2>&1

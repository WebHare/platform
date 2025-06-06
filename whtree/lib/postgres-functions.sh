#!/bin/bash
source "${BASH_SOURCE%/*}/wh-functions.sh"

get_postgres_binaries()   # params: targetvar version
{
  local XXBINDIR
  XXBINDIR=""

  if [ -n "$WEBHARE_IN_DOCKER" ]; then
    XXBINDIR="/usr/lib/postgresql/$2/bin/"
  elif [ "$WEBHARE_PLATFORM" = "darwin" ]; then
    if [ -x "$(brew --prefix)/opt/postgresql@${2}/bin/postgres" ]; then
      XXBINDIR="$(brew --prefix)/opt/postgresql@${2}/bin/"
    fi
  else
    XXBINDIR="/usr/pgsql-$2/bin/"
  fi

  eval $1=\$XXBINDIR
  [ -n "$XXBINDIR" ] && return 0 || return 1
}

load_postgres_settings()
{
  # Let's start (and setup?) PostgreSQL!
  [ -n "$WEBHARE_DBASENAME" ] || die "WEBHARE_DBASENAME name not set"
  [ -n "$WEBHARE_DATAROOT" ] || die "WEBHARE_DATAROOT name not set"

  if [ -n "$WEBHARE_IN_DOCKER" ]; then
    if [ "$(id -u)" == "0" ]; then #don't switch users if we didn't start as root
      RUNAS="chpst -u postgres:whdata"
    fi
  fi

  # We put everything under a postgresql folder, so we can chown that to ourselves in the future
  PSROOT="${WEBHARE_DATAROOT}postgresql"

  if [ -z "$WEBHARE_PGBIN" ]; then
    # Read the version of the PostgreSQL database, fall back to version 16 (as specified in webhare-deps.rb) for new databases
    PGVERSION=$(cat "$PSROOT/db/PG_VERSION" 2>/dev/null || true)
    if [ -z "${PGVERSION}" ]; then
      PGVERSION="$(grep ^postgres_major= "$WEBHARE_DIR/etc/platform.conf" | cut -d= -f2)"
    fi

    PSNAME="PostgreSQL $PGVERSION"
    if ! get_postgres_binaries WEBHARE_PGBIN "$PGVERSION"; then
      echo "This database requires PostgreSQL version ${PGVERSION}. Please install it and point the WEBHARE_PGBIN environment variable to it"
      if [ "$WEBHARE_PLATFORM" = "darwin" ]; then
        echo "You may be able to install it with 'brew install postgresql@${PGVERSION}' or you may need to download binaries directly"
      fi
      exit 1
    fi
  else
    PSNAME="PostgreSQL (from $WEBHARE_PGBIN)"
  fi

  if [ ! -x "$WEBHARE_PGBIN/postgres" ]; then
    echo "Could not find PostgreSQL binaries in $WEBHARE_PGBIN"
    exit 1
  fi

  export PSNAME PSROOT RUNAS PGVERSION WEBHARE_PGBIN
}

function generate_config_file() {
  if [ -z "$WEBHARE_PGCONFIGFILE" ]; then
    if [ -z "$WEBHARE_POSTGRES_OPENPORT" ] && [ -n "$WEBHARE_IN_DOCKER" ]; then  # In Docker, we always open the port
      WEBHARE_POSTGRES_OPENPORT=1
    fi

    if [ -n "$WEBHARE_POSTGRES_OPENPORT" ] ; then
      WEBHARE_PGCONFIGFILE="${BASH_SOURCE%/*}/../etc/postgresql-openport.conf"
    else
      WEBHARE_PGCONFIGFILE="${BASH_SOURCE%/*}/../etc/postgresql-unixonly.conf"
    fi
 fi

 echo "include '$WEBHARE_PGCONFIGFILE'"
  # include_if_exists generates noise if the file doesn't exist
  if [ -f "$WEBHARE_DATAROOT/etc/postgresql-custom.conf" ]; then
    echo "include '$WEBHARE_DATAROOT/etc/postgresql-custom.conf'"
  fi
}

init_webhare_pg_db()
{
  local DATAROOTDIR PGBINDIR

  DATAROOTDIR="$1"
  PGBINDIR="$2"

  mkdir "$DATAROOTDIR/"

  if [ -n "$WEBHARE_IN_DOCKER" ]; then
    chown postgres "$PSROOT" "$DATAROOTDIR"
  fi

  echo "Initializing new PostgreSQL database"
  # Log postgres' output, we only show it when creation fails
  LOGFILE="$(mktemp)"
  if ! $RUNAS "$PGBINDIR/initdb" -U postgres -D "$DATAROOTDIR" --auth-local=trust --encoding 'UTF-8' --locale='C' >"$LOGFILE" 2>&1 ; then
    echo DB initdb failed
    cat "$LOGFILE"
    exit 1
  fi

  # Set the configuration file
  generate_config_file > "$DATAROOTDIR/postgresql.conf"

  # CREATE DATABASE cannot be combined with other commands
  # log in to 'postgres' database so we can create our own
  if ! echo "CREATE DATABASE \"$WEBHARE_DBASENAME\";" | $RUNAS "$PGBINDIR/postgres" --single -D "$DATAROOTDIR" postgres  >"$LOGFILE" 2>&1 ; then
    echo DB create db failed
    cat "$LOGFILE"
    exit 1
  fi
  DOCKERGRANTS=
  if [ -n "$WEBHARE_IN_DOCKER" ]; then
    DOCKERGRANTS="GRANT SELECT ON ALL TABLES IN SCHEMA pg_catalog TO root;GRANT SELECT ON ALL TABLES IN SCHEMA information_schema TO root;"
  fi
  if ! echo "CREATE USER root;ALTER USER root WITH SUPERUSER;GRANT ALL ON DATABASE \"$WEBHARE_DBASENAME\" TO root;$DOCKERGRANTS" | $RUNAS "$PGBINDIR/postgres" --single -D "$DATAROOTDIR" "$WEBHARE_DBASENAME" >"$LOGFILE" 2>&1 ; then
    echo DB create user failed
    cat "$LOGFILE"
    exit 1
  fi

  return 0
}

#!/bin/bash
set -eo pipefail

source "${BASH_SOURCE%/*}/../lib/postgres-functions.sh"
[ -z "$WEBHARE_DATAROOT" ] && die "WEBHARE_DATAROOT not set"

# do any pending switch before analyzing version numbers
if [ -d "${WEBHARE_DATAROOT}postgresql/db.switchto" ]; then
  echo "Switching to NEW postgresql database!"
  mv "${WEBHARE_DATAROOT}postgresql/db" "${WEBHARE_DATAROOT}postgresql/db.bak.$(date +%Y%m%dT%H%M%S)"
  mv "${WEBHARE_DATAROOT}postgresql/db.switchto" "${WEBHARE_DATAROOT}postgresql/db"
fi

load_postgres_settings

cd "${BASH_SOURCE%/*}/../etc/" # this allows PG when running to find the pg_hba-XXX.conf file

[ -z "$PGHOST" ] && die "PGHOST is not set"
[ -z "$PGPORT" ] && die "PGPORT is not set"
[ -z "$PGUSER" ] && die "PGUSER is not set"

# note: we expect PGHOST to be the socket dir!
mkdir -p "$PGHOST" "$PSROOT"
[ -n "$WEBHARE_IN_DOCKER" ] && chown postgres:root "$PGHOST"

if [ ! -d "$PSROOT/db" ]; then

  # remove previous initialization attempt
  if [ -d "$PSROOT/tmp_initdb" ]; then
    echo "Removing previous initialization attempt in $PSROOT/tmp_initdb"
    rm -rf "$PSROOT/tmp_initdb"
  fi

  init_webhare_pg_db "$PSROOT/tmp_initdb" "$WEBHARE_PGBIN"

  mv "$PSROOT/tmp_initdb/" "$PSROOT/db/"
else
  generate_config_file > "$PSROOT/db/postgresql.conf"

  if [ -f "$PSROOT/db/pg_hba.conf" ]; then
    # previous webhares created this file, remove it because it is now unused
    rm -f "$PSROOT/db/pg_hba.conf"
  fi
fi

mkdir -p "$PSROOT/tmp" # ensure we can upload blobs!
echo "Starting $PSNAME"
exec $RUNAS "$WEBHARE_PGBIN/postgres" -D "$PSROOT/db" -c "unix_socket_directories=$PGHOST" -c "port=$PGPORT" 2>&1

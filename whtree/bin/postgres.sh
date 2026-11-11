#!/bin/bash
set -eo pipefail

source "${BASH_SOURCE%/*}/../lib/postgres-functions.sh"
[ -z "$WEBHARE_DATAROOT" ] && die "WEBHARE_DATAROOT not set"

init_postgres_runas
if is_unprivileged_container; then
  # Create postgresql/ (owned by postgres) and the blob and tmp folders WebHare writes to
  "$WEBHARE_PRIVILEGED" prepare-postgresql || die "Unable to prepare ${WEBHARE_DATAROOT}postgresql"
fi

# do any pending switch before analyzing version numbers
if [ -d "${WEBHARE_DATAROOT}postgresql/db.switchto" ]; then
  echo "Switching to NEW postgresql database!"
  $PSRUN mv "${WEBHARE_DATAROOT}postgresql/db" "${WEBHARE_DATAROOT}postgresql/db.bak.$(date +%Y%m%dT%H%M%S)"
  $PSRUN mv "${WEBHARE_DATAROOT}postgresql/db.switchto" "${WEBHARE_DATAROOT}postgresql/db"
fi

load_postgres_settings

cd "${BASH_SOURCE%/*}/../etc/" # this allows PG when running to find the pg_hba-XXX.conf file

[ -z "$PGHOST" ] && die "PGHOST is not set"
[ -z "$PGPORT" ] && die "PGPORT is not set"
[ -z "$PGUSER" ] && die "PGUSER is not set"

# note: we expect PGHOST to be the socket dir!
if is_unprivileged_container; then
  $PSRUN mkdir -p "$PGHOST" # PSROOT was created by prepare-postgresql
else
  mkdir -p "$PGHOST" "$PSROOT"
  [ -n "$WEBHARE_IN_DOCKER" ] && chown postgres:root "$PGHOST"
fi

if [ ! -d "$PSROOT/db" ]; then

  # remove previous initialization attempt
  if [ -d "$PSROOT/tmp_initdb" ]; then
    echo "Removing previous initialization attempt in $PSROOT/tmp_initdb"
    $PSRUN rm -rf "$PSROOT/tmp_initdb"
  fi

  init_webhare_pg_db "$PSROOT/tmp_initdb" "$WEBHARE_PGBIN"

  $PSRUN mv "$PSROOT/tmp_initdb/" "$PSROOT/db/"
else
  write_postgres_config "$PSROOT/db/postgresql.conf"

  # previous webhares created this file, remove it because it is now unused
  $PSRUN rm -f "$PSROOT/db/pg_hba.conf"
fi

ensure_postgres_keys "$PSROOT/db"
$PSRUN chmod 600 "$PSROOT/db/server.key" #because the server will reject the file if its permissions are more liberal than this
if [ -n "$WEBHARE_IN_DOCKER" ] && [ -z "$PSRUN" ]; then # (in unprivileged containers postgres created it)
  chown postgres:whdata "$PSROOT/db/server.key"
fi

mkdir -p "$PSROOT/tmp" # ensure we can upload blobs! (in unprivileged containers, prepare-postgresql created it)
echo "Starting $PSNAME"
exec $RUNAS "$WEBHARE_PGBIN/postgres" -D "$PSROOT/db" -c "unix_socket_directories=$PGHOST" -c "port=$PGPORT" 2>&1

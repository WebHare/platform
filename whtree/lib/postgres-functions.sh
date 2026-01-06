#!/bin/bash
source "${BASH_SOURCE%/*}/wh-functions.sh"

get_postgres_binaries()   # params: targetvar version
{
  local XXBINDIR
  local LOCATIONS=()

  LOCATIONS+=("$WEBHARE_DIR/libexec/postgres/$2/bin/") # Allows you to ship or move a postgres install into the WebHare tree for easier management

  if [ "$WEBHARE_PLATFORM" = "darwin" ]; then
    if [ -x "$(brew --prefix)/opt/postgresql@${2}/bin/postgres" ]; then
      LOCATIONS+=("$(brew --prefix)/opt/postgresql@${2}/bin/")
    fi
  fi

  LOCATIONS+=("/usr/lib/postgresql/$2/bin/") # Debian/Ubuntu
  LOCATIONS+=("/usr/pgsql-$2/bin/")          # RHEL/CentOS/Rocky/Alma/Fedora

  for XXBINDIR in "${LOCATIONS[@]}"; do
    if [ -x "$XXBINDIR/postgres" ]; then
      eval $1=\$XXBINDIR
      return 0
    fi
  done

  echo "Unable to find PostgreSQL $2 binaries. They're expected in one of these locations:" >&2
  for XXBINDIR in "${LOCATIONS[@]}"; do
    echo "- $XXBINDIR" >&2
  done
  echo "" >&2
  echo "Install PostgreSQL $2 into one of these locations or set the WEBHARE_PGIN variable to point to the correct binary directory." >&2
  if [ "$WEBHARE_PLATFORM" = "darwin" ]; then
    echo "You may be able to install it with 'brew install postgresql@$2' or you may need to download binaries directly" >&2
  fi
  exit 1
}

load_postgres_settings()
{
  # Let's start (and setup?) PostgreSQL!
  [ -n "$WEBHARE_DBASENAME" ] || die "WEBHARE_DBASENAME name not set"
  [ -n "$WEBHARE_DATAROOT" ] || die "WEBHARE_DATAROOT name not set"

  if [ -n "$WEBHARE_IN_DOCKER" ] && [ "$(id -u)" == "0" ]; then #don't switch users if we didn't start as root
    if hash -r chpst 2>/dev/null; then
      RUNAS="chpst -u postgres:whdata"
    elif hash -r setpriv 2>/dev/null; then
      RUNAS="setpriv --reuid=postgres --regid=whdata --init-groups "
    else
      die "Error: neither chpst nor setpriv available"
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
    get_postgres_binaries WEBHARE_PGBIN "$PGVERSION"
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
  local DATAROOTDIR PGBINDIR rc

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

  # Launch the database on a separate port so we can configure it without interference
  INSTALL_PORT="$(( $PGPORT + 1 ))"
  pushd "${WEBHARE_DIR}/etc/" # this allows PG when running to find the pg_hba-XXX.conf file
  $RUNAS "$PGBINDIR/postgres"  -c "listen_addresses=" -c "unix_socket_directories=$PGHOST" -c "port=$INSTALL_PORT" -c "ssl=off" -D "$DATAROOTDIR" &
  POSTMASTER_PID=$!
  popd

  # Use psql to wait for it to become available
  until $RUNAS "$PGBINDIR/psql" -U postgres -d postgres -p "$INSTALL_PORT" -c '\q' 2>/dev/null ; do
    >&2 echo "Postgres is unavailable - sleeping"
    sleep .2
  done

  # Bootstrap the database
  rc=0
  $RUNAS "$PGBINDIR/psql" -p "$INSTALL_PORT" -U postgres -d postgres -f "$WEBHARE_DIR/jssdk/whdb/psql/init.psql" ; rc=$?

  # Shut it down so we can start a fully configured postgres on its normal port
  $RUNAS "$PGBINDIR/pg_ctl" -D "$DATAROOTDIR" -m fast stop

  if [ "$rc" != "0" ]; then
    echo DB bootstrap failed with errorcode $rc
    cat "$LOGFILE"
    exit $rc
  fi
  return 0
}

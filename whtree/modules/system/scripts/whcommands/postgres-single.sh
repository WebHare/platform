# short: Starts up postgres in single user mode (for error recovery)

source "$WEBHARE_DIR/lib/wh-functions.sh"
load_postgres_settings

if [ ! -d "$PSROOT/db" ]; then
  echo "$PSROOT/db does not exist, never succesfully started using postgres"
  exit 1
fi

exec $RUNAS $WEBHARE_PGBIN/postgres --single -D $PSROOT/db webhare

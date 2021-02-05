# command: postgres-single
# short: Starts up postgres in single user mode (for error recovery)

PSROOT="${WEBHARE_DATAROOT}/postgresql"

if [ ! -d "$PSROOT/db" ]; then
  echo "$PSROOT/db does not exist, never succesfully started using postgres"
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

 exec $RUNAS $PSBIN/postgres --single -c "default_transaction_read_only=off" -D $PSROOT/db webhare

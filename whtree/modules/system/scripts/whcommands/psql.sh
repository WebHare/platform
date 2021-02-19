# okay, not impressive but maybe we will be at one point (eg to look up connection settings?)

source $WEBHARE_DIR/lib/wh-functions.sh

if [ -z "$WEBHARE_DBASENAME" ]; then
  die "WEBHARE_DBASENAME name not set"
fi

# -c in arguments? Then make transactions writable
if [[ " $@ " =~ " -c " ]]; then
  ARGS=("-c" "SET SESSION CHARACTERISTICS AS TRANSACTION READ WRITE")
else
  echo "Opening psql with readonly transactions by default. To start a writable transaction, use" 1>&2
  echo "  START TRANSACTION READ WRITE;" 1>&2
fi
exec psql --host $WEBHARE_DATAROOT/postgresql $WEBHARE_DBASENAME "${ARGS[@]}" "$@"

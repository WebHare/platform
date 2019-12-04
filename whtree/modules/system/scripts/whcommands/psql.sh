# okay, not impressive but maybe we will be at one point (eg to look up connection settings?)


if [ -z "$WEBHARE_DBASENAME" ]; then
  echo "WEBHARE_DBASENAME name not set"
  exit 1
fi

# -c in arguments? Then make transactions writable
if [[ " $@ " =~ " -c " ]]; then
  ARGS=("-c" "SET SESSION CHARACTERISTICS AS TRANSACTION READ WRITE")
else
  echo "Opening psql with readonly transactions by default. To start a writable transaction, use"
  echo "  START TRANSACTION READ WRITE;"
fi
exec psql --host $WEBHARE_DATAROOT/postgresql $WEBHARE_DBASENAME "${ARGS[@]}" "$@"

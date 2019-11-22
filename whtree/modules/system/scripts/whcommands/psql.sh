# okay, not impressive but maybe we will be at one point (eg to look up connection settings?)


if [ -z "$WEBHARE_DBASENAME" ]; then
  echo "WEBHARE_DBASENAME name not set"
  exit 1
fi

exec psql --host $WEBHARE_DATAROOT/postgresql $WEBHARE_DBASENAME -c "SET SESSION CHARACTERISTICS AS TRANSACTION READ WRITE" "$@"

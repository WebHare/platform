if [ -d $WEBHARE_DATAROOT/postgresql/db.switchto ]; then
  echo "$WEBHARE_DATAROOT/postgresql/db.switchto exists"
  echo "Complete your current switch by restarting WebHare before deleting any more databases"
  exit 1
fi

if [ -d $WEBHARE_DATAROOT/dbase -a -f $WEBHARE_DATAROOT/postgresql/db/postgresql.conf -a "$__WEBHARE_DBASE" == "postgresql" ] ; then
  echo "It looks like you've switched to PostgresSQL so removing old dbserver 'dbase' directory in..."
  sleep 1
  for P in 5 4 3 2 1 ; do
    echo "$P..."
    sleep 1
  done
  rm -rf $WEBHARE_DATAROOT/dbase
fi
for P in $WEBHARE_DATAROOT/postgresql/db.* ; do
  if [ -d $P ]; then
    echo "Removing previous database $P"
    rm -rf "$P"
  fi
done

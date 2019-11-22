# command: catlog [-f] <logfile>
# short: List today's logfiles

source $WEBHARE_DIR/lib/wh-functions.sh
unset FOLLOW

if [ "$1" == "-f" ]; then
  FOLLOW=1
  shift
fi

if [ -z "$1" ]; then
  echo "Which log file to read? eg 'rpc'"
  exit 1
fi

while [ -n "$1" ]; do
  getlog LOG $1
  LOGS="$LOGS $LOG"
  shift
done

if [ "$FOLLOW" ] ; then
  exec tail -f -c +1 $LOGS
else
  exec cat $LOGS
fi

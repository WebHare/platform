# command: watchlog
# short: Monitor error & service manager logs

source $WEBHARE_DIR/lib/wh-functions.sh

if [ -z "$1" ]; then
  getlog SVCLOG servicemanager
  getlog ERRORLOG errors
  getlog NOTICELOG notice
  LOGS="$SVCLOG $ERRORLOG $NOTICELOG"
else
  while [ -n "$1" ]; do
    getlog LOG $1
    LOGS="$LOGS $LOG"
    shift
  done
fi
echo Logs: $LOGS
tail -f $LOGS

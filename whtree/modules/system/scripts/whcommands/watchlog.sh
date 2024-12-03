#!/bin/bash
# short: Monitor error & service manager logs

source "$WEBHARE_DIR/lib/wh-functions.sh"

if [ -z "$1" ]; then
  getlog SVCLOG servicemanager
  getlog ERRORLOG errors
  getlog NOTICELOG notice
  LOGS=("$SVCLOG" "$ERRORLOG" "$NOTICELOG")
else
  LOGS=()
  while [ -n "$1" ]; do
    getlog LOG $1
    LOGS+=("$LOG")
    shift
  done
fi

# Print which logs are shown if more than one (to stderr to avoid breaking pipes)
if [ ${#LOGS[@]} -gt 1 ]; then
  echo Logs: "${LOGS[@]}" 1>&2
fi

tail -f "${LOGS[@]}"

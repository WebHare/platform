#!/bin/bash
# short: Execute node with our typescript compiler plugin loaded

if [ -z "$WEBHARE_DATAROOT" ]; then
  echo WEBHARE_DATAROOT not set, cannot invoke node
  exit 1
fi

export NODE_REPL_EXTERNAL_MODULE="@mod-platform/js/cli/repl-launch.ts"

# is the 'heavy' node profiler enabled?
if [ -n "$WEBHARE_NODEPROFILE" ]; then
  WORKDIR="$(mktemp -d)"
  WEBHARE_NODE_OPTIONS="--logfile="$WORKDIR/log" --prof $WEBHARE_NODE_OPTIONS"
  wh_runjs "$@"
  RETVAL="$?"
  OUTPUTFILES=()
  for P in "$WORKDIR"/* ; do
    echo "Postprocessing logfile $P... " >&2
    node --prof-process "$P" > "$P.txt"
    echo "$P.txt" >&2
    OUTPUTFILES+=( "$P.txt" )
  done
  if [ "$WEBHARE_NODEPROFILE" == "less" ]; then
    less "${OUTPUTFILES[@]}"
  fi
  exit $RETVAL
fi

exec_wh_runjs "$@"

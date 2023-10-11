#!/bin/bash
# short: Execute node with our typescript compiler plugin loaded

# Parse options (we used to have --validate)
while true; do
  if [[ $1 =~ ^- ]]; then
    echo "Illegal option '$1'"
    exit 1
  else
    break
  fi
done

if [ -z "$WEBHARE_DATAROOT" ]; then
  echo WEBHARE_DATAROOT not set, cannot invoke node
  exit 1
fi

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
echo "wh node: the actual node binary was not found" 1>&2
exit 255

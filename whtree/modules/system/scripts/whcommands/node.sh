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

ARGS=("$@")

# is the 'apr' flag set ?
if [[ $WEBHARE_DEBUG =~ ((^|[,])apr([,]|$))+ ]] ; then
  # prefix with profile starter. note that this for now just prints some simple stats to stdout (and is not compatible with nodejs --prof/--prof-process - but much faster)
  ARGS=("${BASH_SOURCE%/*}/../../js/internal/debug/autoprofile.ts" "${ARGS[@]}")
fi

export NODE_PATH="$WEBHARE_DATAROOT/node_modules"
export NODE_OPTIONS="--enable-source-maps -r \"${BASH_SOURCE%/*}/../../js/internal/generated/resolveplugin.js\" $NODE_OPTIONS"
# TODO is this still used? or is the esbuild plugin just looking up in the tree?
export TS_NODE_PROJECT="$WEBHARE_DATAROOT/tsconfig.json"

# is the 'heavy' node profiler enabled?
if [ -n "$WEBHARE_NODEPROFILE" ]; then
  WORKDIR="$(mktemp -d)"
  node --logfile="$WORKDIR/log" --prof $WEBHARE_NODE_OPTIONS "${ARGS[@]}"
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

exec node $WEBHARE_NODE_OPTIONS "${ARGS[@]}"
echo "wh node: the actual node binary was not found" 1>&2
exit 255

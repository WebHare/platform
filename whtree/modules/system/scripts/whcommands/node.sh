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

SCRIPT="$1"
shift

export NODE_PATH="$WEBHARE_DATAROOT/node_modules"
# TODO is this still used? or is the esbuild plugin just looking up in the tree?
export TS_NODE_PROJECT="$WEBHARE_DATAROOT/tsconfig.json"

exec node --enable-source-maps -r "${BASH_SOURCE%/*}/../../js/internal/generated/resolveplugin.js" "$SCRIPT" "$@"
echo "wh node: the actual node binary was not found" 1>&2
exit 255

#!/bin/bash
# short: Execute node with our typescript compiler plugin loaded

VALIDATE=

# Parse options
while true; do
  if [ "$1" == "--validate" ]; then
    VALIDATE=1
    shift
  elif [[ $1 =~ ^- ]]; then
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

if [ -n "$VALIDATE" ]; then
  # There's still no decent solution from tsc itself yet - see https://github.com/microsoft/TypeScript/issues/27379
  # We'll generate a temporary configuration and put it below WEBHARE_DATAROOT to be able to find @types/node
  TEMPVALIDATIONCONFIG="$WEBHARE_DATAROOT/tmp/validate-tsconfig-$$.json"
  echo "{\"extends\": \"$TS_NODE_PROJECT\", \"include\": [\"$(realpath "$SCRIPT")\"] }" > $TEMPVALIDATIONCONFIG
  "${BASH_SOURCE%/*}/../../../../node_modules/.bin/tsc" --noEmit --project "$TEMPVALIDATIONCONFIG"
  retval="$?"
  rm $TEMPVALIDATIONCONFIG #cleanup config file
  if [ "$retval" != "0" ]; then
    exit 254
  fi
fi

exec node --enable-source-maps -r "${BASH_SOURCE%/*}/../../js/internal/generated/resolveplugin.js" "$SCRIPT" "$@"
echo "wh node: the actual node binary was not found" 1>&2
exit 255

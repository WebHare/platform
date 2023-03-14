#!/bin/bash

ONLYBASECONFIG=
while [[ $1 =~ ^-.* ]]; do
  if [ "$1" == "--onlybaseconfig" ]; then
    ONLYBASECONFIG=1
  else
    echo "Illegal option $1"
    exit 1
  fi
  shift
done

if [ "$#" != "0" ]; then
  echo "Illegal parameter $1"
  exit 1
fi

if [ -n "$ONLYBASECONFIG" ]; then
  # Update the base configuration without accessing the database or configuration files
  TS_NODE_PROJECT="$WEBHARE_DATAROOT/tsconfig.json" node --enable-source-maps -r "${BASH_SOURCE%/*}/../../js/internal/generated/resolveplugin.js" "${BASH_SOURCE%/*}/../internal/updateconfigfilebase.ts"
else
  exec wh run "${BASH_SOURCE%/*}/../internal/updategeneratedfiles.ts"
fi

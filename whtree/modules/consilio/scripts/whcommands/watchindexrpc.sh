#!/bin/bash

# syntax: <catalogname>
# short: Watch OpenSearch RPC traffic for a catalog

function disabletraffic()
{
  wh debug disable consilio:traffic
}

if ! wh harescript-debug getconfig | grep -q consilio:traffic ; then
  wh debug enable consilio:traffic
  trap disabletraffic EXIT
fi

INDEXREGEX="$(wh run mod::consilio/scripts/internal/getindexnames.whscr "$1")"
if [ -z "$INDEXREGEX" ]; then
  exit 1 #getindexnames should have printed an error
fi

wh watchlog debug | grep --line-buffered -E "${INDEXREGEX}|--- MARK: "

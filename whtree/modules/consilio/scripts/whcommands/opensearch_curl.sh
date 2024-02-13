#!/bin/bash

# syntax: [options] <url>
# short: Apply curl to builtin opensearch

[ -z "$1" ] && die "Invalid syntax - no URL given"

ARGS=( "$@" )
URL="${ARGS[${#ARGS[@]}-1]}"
unset "ARGS[${#ARGS[@]}-1]"

[ "${URL:0:1}" == "-" ] && die "Invalid syntax - no URL given"

# ensure we start with a slash
[ "${URL:0:1}" == "/" ] || URL="/$URL"

# forward to curl!
if [ -z "$WEBHARE_OPENSEARCH_BINDHOST" ]; then
  WEBHARE_OPENSEARCH_BINDHOST=127.0.0.1
fi

WEBHARE_OPENSEARCH_PORT="$((WEBHARE_BASEPORT + 6))"

# avoid progress bars
curl --silent "${ARGS[@]}" "http://${WEBHARE_OPENSEARCH_BINDHOST}:${WEBHARE_OPENSEARCH_PORT}${URL}"
RETVAL="$?"

if [ -t 1 ]; then #stdout looks like a terminal...
  # Add extra line because most opensearch responses don't..
  # based on https://unix.stackexchange.com/questions/88296/get-vertical-cursor-position/183121#183121
  IFS=';' read -sdR -p $'\E[6n' ROW COL
  (( $COL > 1 )) && echo
fi

exit $RETVAL

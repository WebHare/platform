#!/bin/bash

die() {
  echo "$@"; exit 1
}

logWithTime()
{
  local now
  if [[ "$OSTYPE" == "darwin"* ]]; then  #mac doesn't support .%3N
    now=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
  else
    now=$(date -u +'%Y-%m-%dT%H:%M:%S.%3NZ')
  fi

  echo "[$now]" "$1"
}



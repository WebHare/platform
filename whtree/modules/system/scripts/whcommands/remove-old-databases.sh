#!/bin/bash
for P in "$WEBHARE_DATAROOT"/postgresql/db.* ; do
  if [ -d "$P" ]; then
    echo "Removing previous database $P"
    rm -rf "$P"
  fi
done

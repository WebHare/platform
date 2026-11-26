#!/bin/bash
# short: exit restore mode

SERVERROLES=""
while [ -n "$1" ]; do
  if [ "$1" == "--keep-serverroles" ]; then
    SERVERROLES="keep"
  elif [ "$1" == "--clear-serverroles" ]; then
    SERVERROLES="clear"
  else
    echo "Syntax: wh exit-restore-mode [ --keep-serverroles | --clear-serverroles ]"
    echo "  --keep-serverroles:  keep the server roles of the server this backup was made on"
    echo "  --clear-serverroles: remove the stored server roles"
    exit 1
  fi
  shift
done

if [ ! -e "$WEBHARE_DATAROOT/webhare.restoremode" ]; then
  if [ -z "$WEBHARE_ISRESTORED" ]; then
    echo "This WebHare does not appear to run in restore mode"
    exit 1
  fi
  echo "This WebHare has not placed into restore mode by using a webhare.restoremode file. You may need to manually fix the environment variables."
  exit 1
fi

# The stored server roles come from the server the backup was made on. Restore mode ignores them, but once we exit
# restore mode they become active again unless WEBHARE_SERVERROLES is set. So make the user decide what to do with them
if ! STOREDROLES="$(wh registry get system:global.serverroles)"; then
  echo "Failed to read the stored server roles. Is WebHare running?"
  exit 1
fi

if [ -n "$STOREDROLES" ]; then
  if [ -z "$SERVERROLES" ]; then
    echo "This server has configured server roles, which may come from the server the backup was made on: $STOREDROLES"
    echo "Specify --keep-serverroles to keep them or --clear-serverroles to remove them"
    exit 1
  fi
  if [ "$SERVERROLES" == "clear" ]; then
    # No need to apply the configuration: WebHare is relaunched below
    if ! wh registry set system:global.serverroles ""; then
      echo "Failed to clear the stored server roles"
      exit 1
    fi
  fi
fi

rm -f "$WEBHARE_DATAROOT/webhare.restoremode"
if [ -e "$WEBHARE_DATAROOT/webhare.restoremode" ]; then
  echo "Failed to remove restoremode file"
  exit 1
fi

echo "webhare.restoremode has been removed, restarting WebHare to finally exit restore mode"
wh service relaunch

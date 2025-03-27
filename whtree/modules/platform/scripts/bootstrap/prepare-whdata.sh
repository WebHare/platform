#!/bin/bash

# prepare-whdata sets up the WebHare data ($WEBHARE_DATAROOT, whdata) directory
#
# We need to be in shell script as TypeScript isn't available yet - we're bootstrapping TS support!

FORCE=""
VERBOSE=""

while [[ $1 =~ ^-.* ]]; do
  if [ "$1" == "--force" ]; then
    FORCE="1"
  elif [ "$1" == "--verbose" ]; then
    VERBOSE="1"
  else
    echo "Illegal option $1"
    exit 1
  fi
  shift
done

ensure_link()
{
  local currentdest
  if [ ! -e "$2" ]; then # if it doesn't exist, create it
    ln -sf "$1" "$2"
    return
  fi

  currentdest="$(readlink $2)"
  if [ "$currentdest" != "$1" ]; then
    echo "Fixing $2 pointing to $currentdest but it should point to $1" 1>&2
    rm "$2" # we need to rm first if we want to ensure a slash at the end
    ln -sf "$1" "$2"
  fi
}

# Setup basic symlinks for @mod- and @webhare- helpers so we can refer to them from JS (wh node sets NODE_PATH to "$WEBHARE_DATAROOT/node_modules")
if [ -z "$WEBHARE_DATAROOT" ]; then
  echo WEBHARE_DATAROOT not configured!
  exit 1
fi

CONFIGDIR="$WEBHARE_DATAROOT/config"
CONFIGJSON="$CONFIGDIR/platform.json"
if [ -z "$FORCE" ] && [ -h "$WEBHARE_DATAROOT/node_modules/@webhare" ] && [ -f "$CONFIGJSON" ]; then
  [ -n "$VERBOSE" ] && echo "prepare-whdata: it looks like $WEBHARE_DATAROOT has already been prepared" 1>&2
  exit 0
fi

mkdir -p "$WEBHARE_DATAROOT"/lib "$WEBHARE_DATAROOT"/home "$WEBHARE_DATAROOT"/tmp >/dev/null 2>&1

# Make sure node_modules and links point to the right place. A restore or move might have misplaced them and will break bootstrapping various other scripts
# node might not actually be functional yet at this point so fix the basic links in the shell
mkdir -p "$WEBHARE_DATAROOT/node_modules"
for mod in consilio platform publisher system tollium wrd; do
  ensure_link "${WEBHARE_DIR}/modules/${mod}/" "$WEBHARE_DATAROOT/node_modules/@mod-${mod}"
done
ensure_link "${WEBHARE_DIR}/jssdk/" "$WEBHARE_DATAROOT/node_modules/@webhare"

# Update/generate whdata/config/platform.json - C++ will need it too for the module mapping
# Update/generate whdata/config/extracts/ - core/nodesevices require the list of managed services
if ! WEBHARE_NODE_OPTIONS= WEBHARE_NO_CONFIG=1 wh apply --offline --nodb "${STARTUPOPTIONS[@]}" config.extracts ; then
  echo "Failed to update the configuration file, aborting"  1>&2
  exit 1
fi

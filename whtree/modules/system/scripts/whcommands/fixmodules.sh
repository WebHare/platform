#!/bin/bash
source $WEBHARE_DIR/lib/wh-functions.sh

# syntax: [ --onlymodules ] [modules]
# short: Install any missing npm components for modules

containsElement()
{
  local e
  for e in "${@:2}"; do [[ "$e" == "$1" ]] && return 0; done
  return 1
}

NOCOMPILE=
DRYRUNPREFIX=""

while [[ $1 =~ -.* ]]; do
  if [ "$1" == "--onlymodules" ]; then #ignored. wh finalize-webhare fixes WebHare
    shift
  elif [ "$1" == "--onlyinstalledmodules" ]; then #ignored. wh finalize-webhare fixes WebHare
    shift
  elif [ "$1" == "--onlybroken" ]; then
    echo "--onlybroken is now the default. use '*' to process all modules"
    exit 1
  elif [ "$1" == "--nocompile" ]; then
    NOCOMPILE=1
    shift
  elif [ "$1" == "--dryrun" ]; then
    DRYRUNPREFIX="echo"
    shift
  elif [ "$1" == "--" ]; then
    shift
    break
  else
    die "Illegal option '$1'"
  fi
done

loadshellconfig

FAILED=0
# --silent also kills error logging, so just try to prevent as much as possible
NPMOPTIONS="--no-update-notifier --quiet --no-fund --no-audit --no-save --ignore-scripts --no-progress --omit=peer"

# ensure module maps are up-to-date (TODO we really need more coordination here, especially in CI. wh fixmodules racing wh console startup is painful)
wh update-generated-files --update=config --nodb

if [ "$#" == 1 ] && [ "$1" == "*" ]; then
  if [ -n "$ONLYINSTALLEDMODULES" ]; then
    MODULESLIST=($(wh getinstalledmodulelist))
  else
    MODULESLIST=($(wh getmodulelist))
  fi
  if [ "$INCLUDEWEBHARE" == "1" ]; then
    #prepend webhare to the list
    MODULESLIST=(webhare "${MODULESLIST[@]}")
  fi
elif [ "$#" != 0 ]; then
  MODULESLIST=("$@")
else
  MODULESLIST=($(time wh runwasm mod::system/scripts/internal/listbrokenmodules.whscr))
fi

for MODULENAME in "${MODULESLIST[@]}"; do
  if [ "$MODULENAME" == "webhare" ]; then
    echo "Updating WebHare Platform"
    wh -i finalize-webhare
    continue
  else # MODULENAME != webhare
    getmoduledir MODULEDIR $MODULENAME
    cd "$MODULEDIR" || exit 1
    if [ -f package.json ]; then
      echo "Installing npm modules for module '$MODULENAME'"
      $DRYRUNPREFIX npm install $NPMOPTIONS
    fi

    for Q in "$MODULEDIR/webdesigns"/?* ; do
      if cd "$Q" 2>/dev/null ; then
        echo "Installing npm modules for webdesign '$MODULENAME:$(basename "$Q")'"

        if [ -f package.json ]; then
          $DRYRUNPREFIX npm install $NPMOPTIONS
          RETVAL=$?
          if [ "$RETVAL" != "0" ]; then
            echo NPM FAILED with errorcode $RETVAL
            FAILED=1
          fi
        fi
      fi
    done
  fi # ends MODULENAME != webhare

  if [ -x "$MODULEDIR/scripts/fixmodules-plugin.sh" ]; then
    cd "${MODULEDIR}" || exit 1
    $DRYRUNPREFIX "$MODULEDIR/scripts/fixmodules-plugin.sh"
    RETVAL=$?
    if [ "$RETVAL" != "0" ]; then
      echo "Module plugin for module '$MODULENAME' failed with errorcode $RETVAL"
      FAILED=1
    fi
  fi

done

# Now recompile all modules that we updated
if [ -z "$NOCOMPILE" ]; then
  for MODULENAME in ${MODULESLIST[@]}; do
    if [ "$MODULENAME" != "webhare" ]; then
      $DRYRUNPREFIX wh assetpacks --quiet recompile "$MODULENAME:*"
      RETVAL=$?
      if [ "$RETVAL" != "0" ]; then
        echo "wh assetpacks recompile for module '$MODULENAME' failed with errorcode $RETVAL"
        FAILED=1
      fi
    fi
  done

  # And now, just in case a module wasn't broken modulewise but still had broken packages, recompile any broken modules
  $DRYRUNPREFIX wh assetpacks --quiet recompile --onlyfailed "*"
  RETVAL=$?
  if [ "$RETVAL" != "0" ]; then
    echo "wh assetpacks recompile --onlyfailed failed with errorcode $RETVAL"
    FAILED=1
  fi
fi

exit $FAILED

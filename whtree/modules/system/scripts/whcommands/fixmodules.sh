#!/bin/bash
source $WEBHARE_DIR/lib/wh-functions.sh

# command: fixmodules [ --onlymodules ] [modules]
# short: Install any missing npm components for modules

containsElement()
{
  local e
  for e in "${@:2}"; do [[ "$e" == "$1" ]] && return 0; done
  return 1
}

INCLUDEWEBHARE=1
ONLYMODULES=
ONLYBROKEN=
LISTBROKENOPTS=""
NOCOMPILE=
ONLYINSTALLEDMODULES=

while [[ $1 =~ -.* ]]; do
  if [ "$1" == "--onlymodules" ]; then
    ONLYMODULES=1
    INCLUDEWEBHARE=
    LISTBROKENOPTS="$LISTBROKENOPTS --onlymodules"
    shift
  elif [ "$1" == "--onlyinstalledmodules" ]; then
    ONLYINSTALLEDMODULES=1
    INCLUDEWEBHARE=
    LISTBROKENOPTS="$LISTBROKENOPTS --onlyinstalledmodules"
    shift
  elif [ "$1" == "--onlybroken" ]; then
    ONLYBROKEN=1
    shift
  elif [ "$1" == "--nocompile" ]; then
    NOCOMPILE=1
    shift
  elif [ "$1" == "--" ]; then
    shift
    break
  else
    die "Illegal option '$1'"
  fi
done

loadshellconfig
setup_node
NOEXEC=1 # make sure noderun is not terminal

FAILED=0

if [ -n "$ONLYBROKEN" ]; then
  MODULESLIST=($(wh run mod::system/scripts/internal/listbrokenmodules.whscr $LISTBROKENOPTS))
elif [ "$#" == 0 ]; then
  if [ -n "$ONLYINSTALLEDMODULES" ]; then
    MODULESLIST=($(wh getinstalledmodulelist))
  else
    MODULESLIST=($(wh getmodulelist))
  fi
  if [ "$INCLUDEWEBHARE" == "1" ]; then
    #prepend webhare to the list
    MODULESLIST=(webhare "${MODULESLIST[@]}")
  fi
else
  MODULESLIST=("$@")
fi

for MODULENAME in ${MODULESLIST[@]}; do
  if [ "$MODULENAME" == "webhare" ]; then
    echo "Updating WebHare Platform"
    cd "$WEBHARE_DIR"
    npm install --no-update-notifier --silent --no-save --ignore-scripts
    RETVAL=$?
    if [ "$RETVAL" != "0" ]; then
      echo NPM FAILED with errorcode $RETVAL
      FAILED=1
    fi
  else # MODULENAME != webhare
    getmoduledir MODULEDIR $MODULENAME
    cd "$MODULEDIR"
    if [ -f package.json ]; then
      echo "Installing npm modules for module '$MODULENAME'"
      npm install --no-update-notifier --silent --ignore-scripts --no-save
    fi

    for Q in $MODULEDIR/webdesigns/?* ; do
      if cd $Q 2>/dev/null ; then
        echo "Installing npm modules for webdesign '$MODULENAME:$(basename "$Q")'"

        if [ -f package.json ]; then
          npm install --no-update-notifier --silent --ignore-scripts --no-save
          RETVAL=$?
          if [ "$RETVAL" != "0" ]; then
            echo NPM FAILED with errorcode $RETVAL
            FAILED=1
          fi
        fi
      fi
    done

    if [ -x $MODULEDIR/scripts/fixmodules-plugin.sh ]; then
      cd $MODULEDIR
      $MODULEDIR/scripts/fixmodules-plugin.sh
      RETVAL=$?
      if [ "$RETVAL" != "0" ]; then
        echo "Module plugin for module '$MODULEDIR' failed with errorcode $RETVAL"
        FAILED=1
      fi
    fi

  fi # ends MODULENAME != webhare
done

# Now recompile all modules that we updated
if [ -z "$NOCOMPILE" ]; then
  for MODULENAME in ${MODULESLIST[@]}; do
    if [ "$MODULENAME" != "webhare" ]; then
      wh assetpacks --quiet recompile "$MODULENAME:*"
      RETVAL=$?
      if [ "$RETVAL" != "0" ]; then
        echo "wh assetpacks recompile for module '$MODULENAME' failed with errorcode $RETVAL"
        FAILED=1
      fi
    fi
  done

  # And now, just in case a module wasn't broken modulewise but still had broken packages, recompile any broken modules
  wh assetpacks --quiet recompile --onlyfailed "*"
  RETVAL=$?
  if [ "$RETVAL" != "0" ]; then
    echo "wh assetpacks recompile --onlyfailed failed with errorcode $RETVAL"
    FAILED=1
  fi
fi

exit $FAILED

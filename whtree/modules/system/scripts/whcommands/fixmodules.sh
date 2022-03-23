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

ONLYMODULES=
ONLYBROKEN=
NOCOMPILE=
while [[ $1 =~ -.* ]]; do
  if [ "$1" == "--onlymodules" ]; then
    ONLYMODULES=1
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
  MODULESLIST=($(wh run mod::system/scripts/internal/listbrokenmodules.whscr))
elif [ "$#" == 0 ]; then
  MODULESLIST=($(wh getmodulelist))
  if [ "$ONLYMODULES" != "1" ]; then
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
    npm install --no-save --ignore-scripts
    RETVAL=$?
    if [ "$RETVAL" != "0" ]; then
      echo NPM FAILED with errorcode $RETVAL
      FAILED=1
    fi
  else # MODULENAME != webhare
    getmoduledir MODULEDIR $MODULENAME
    cd "$MODULEDIR"
    if [ -f package.json ]; then
      echo "Installing NPM modules for module '$MODULENAME'"
      npm install --ignore-scripts --no-save
    fi

    for Q in $MODULEDIR/webdesigns/?* ; do
      if cd $Q 2>/dev/null ; then
        echo "Installing NPM modules for webdesign '$MODULENAME:$(basename \"$Q\")'"

        if [ -f package.json ]; then
          npm install --ignore-scripts --no-save
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

    if [ -z "$NOCOMPILE" ]; then
      wh assetpacks recompile "$MODULENAME:*";
      RETVAL=$?
      if [ "$RETVAL" != "0" ]; then
        echo "wh assetapcks recompile for module '$MODULEDIR' failed with errorcode $RETVAL"
        FAILED=1
      fi
    fi

  fi # ends MODULENAME != webhare
done

exit $FAILED

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
while [[ $1 =~ -.* ]]; do
  if [ "$1" == "--onlymodules" ]; then
    ONLYMODULES=1
    shift
  elif [ "$1" == "--onlybroken" ]; then
    ONLYBROKEN=1
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
MODULESLIST=("$@")

FAIL=0

# TODO once we drop support for lockfile V1 and just error-out on it, we can remove the lockfileVersion checks here

if [ -z "$ONLYBROKEN" ]; then
  if [ -z "$ONLYMODULES" ] && [ "$#" == 0 ] && cd $WEBHARE_DIR 2>/dev/null ; then
    echo "Updating WebHare"
    npm install --no-save --ignore-scripts
    NPMRETVAL=$?
    if [ "$NPMRETVAL" != "0" ]; then
      echo NPM FAILED with errorcode $NPMRETVAL
      FAIL=1
    fi
  fi

  for P in $WEBHARE_CFG_MODULES ; do
    if [ "$#" != 0 ] && ! containsElement $P "${MODULESLIST[@]}"; then
      continue
    fi
    MODULENAME=$P
    getmoduledir MODULEDIR $P
    cd $MODULEDIR
    if [ -f package.json ]; then
      if grep -q '"lockfileVersion": *1' package-lock.json 2> /dev/null; then
        npm install --ignore-scripts # upgrade lockfile
      else
        npm install --ignore-scripts --no-save
      fi
    fi

    for Q in $MODULEDIR/webdesigns/?* ; do
      if cd $Q 2>/dev/null ; then
        echo "Updating webdesign '$MODULENAME:`basename \"$Q\"`'"

        if [ -f package.json ]; then
          if grep -q '"lockfileVersion": *1' package-lock.json 2> /dev/null; then
            npm install --ignore-scripts # upgrade lockfile
          else
            npm install --ignore-scripts --no-save
          fi
          NPMRETVAL=$?
          if [ "$NPMRETVAL" != "0" ]; then
            echo NPM FAILED with errorcode $NPMRETVAL
            FAIL=1
          fi
        fi
      fi
    done

    if [ -x $MODULEDIR/scripts/fixmodules-plugin.sh ]; then
      cd $MODULEDIR
      $MODULEDIR/scripts/fixmodules-plugin.sh
      FIXRETVAL=$?
      if [ "$FIXRETVAL" != "0" ]; then
        echo "Module plugin for module '$MODULEDIR' failed with errorcode $FIXRETVAL"
        FAIL=1
      fi
    fi
  done
else
  while read -r path
  do
    if cd "$path" 2>/dev/null ; then
      echo "Updating $path"
      if [ -f package.json ]; then
        if grep -q '"lockfileVersion": *1' package-lock.json 2> /dev/null; then
          npm install --ignore-scripts # upgrade lockfile
        else
          npm install --ignore-scripts --no-save
        fi
        NPMRETVAL=$?
        if [ "$NPMRETVAL" != "0" ]; then
          echo NPM FAILED with errorcode $NPMRETVAL
          FAIL=1
        fi
      fi
    fi
  done < <(wh run mod::system/scripts/internal/listupdatablenodefolders.whscr)
fi

exit $FAIL

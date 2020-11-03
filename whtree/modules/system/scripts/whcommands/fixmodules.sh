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
    echo "Illegal option '$1'"
    exit 1
  fi
done

loadshellconfig
setup_node
NOEXEC=1 # make sure noderun is not terminal
MODULESLIST=("$@")

FAIL=0

if [ -z "$ONLYBROKEN" ]; then
  if [ -z "$ONLYMODULES" ] && [ "$#" == 0 ] && cd $WEBHARE_DIR 2>/dev/null ; then
    echo "Updating WebHare"
    wh npm install --no-save
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
    [ -f package.json ] && npm install --no-save

    for Q in $MODULEDIR/webdesigns/?* ; do
      if cd $Q 2>/dev/null ; then
        echo "Updating webdesign '$MODULENAME:`basename \"$Q\"`'"
        [ -f node_modules/.yarn-integrity ] && rm node_modules/.yarn-integrity #we're switching away from yarn. until everyone's up to date, force it to go away

        if [ -f package.json ]; then
          npm install --no-save
          NPMRETVAL=$?
          if [ "$NPMRETVAL" != "0" ]; then
            echo NPM FAILED with errorcode $NPMRETVAL
            FAIL=1
          fi
        fi
      fi
    done
  done
else
  while read -r path
  do
    if cd "$path" 2>/dev/null ; then
      echo "Updating $path"
      if [ -f package.json ]; then
        npm install --no-save
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

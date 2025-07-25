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
  if [ "$1" == "--onlyinstalledmodules" ]; then #ignored. wh finalize-webhare fixes WebHare. kept for compatibility with wh testcontainer (which sends this parameter for 5.3 and below)
    shift
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

FAILED=0
# --silent also kills error logging, so just try to prevent as much as possible
NPMOPTIONS="--no-update-notifier --quiet --no-fund --no-audit --no-save --ignore-scripts --no-progress --omit=peer"

# ensure module maps are up-to-date (TODO we really need more coordination here, especially in CI. wh fixmodules racing wh console startup is painful)
wh apply --offline --nodb config.base

if [ "$#" == 1 ] && [ "$1" == "*" ]; then
  # this list changes too rarely to bother with the only 'wh getinstalledmodules' call
  # once we port fixmodules to TS we can read webhareconstant_builtinmodules
  MODULESLIST="consilio platform publisher socialite system tollium wrd"
elif [ "$#" != 0 ]; then
  MODULESLIST=("$@")
else
  MODULESLIST=($(wh_runwhscr mod::system/scripts/internal/listbrokenmodules.whscr))
fi

for MODULENAME in "${MODULESLIST[@]}"; do
  getmoduledir MODULEDIR $MODULENAME
  cd "$MODULEDIR" || exit 1
  # TODO the locations we check need to be in sync with what `listNodePackageRoots` looks for
  for Q in "$MODULEDIR" "$MODULEDIR/tests" "$MODULEDIR/webdesigns"/?* ; do
    if cd "$Q" 2>/dev/null ; then
      if [ -f package.json ]; then
        echo "Installing npm modules for $Q"
        $DRYRUNPREFIX npm install $NPMOPTIONS
        RETVAL=$?
        if [ "$RETVAL" != "0" ]; then
          echo NPM FAILED with errorcode $RETVAL
          FAILED=1
        fi
      fi
    fi
  done

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
  for MODULENAME in "${MODULESLIST[@]}"; do
    $DRYRUNPREFIX wh assetpack --quiet --allow-missing compile "$MODULENAME:*"
    RETVAL=$?
    if [ "$RETVAL" != "0" ]; then
      echo "wh assetpack compile for module '$MODULENAME' failed with errorcode $RETVAL"
      FAILED=1
    fi
  done

  # And now, just in case a module wasn't broken modulewise but still had broken packages, recompile any broken modules
  $DRYRUNPREFIX wh assetpack --quiet compile --onlyfailed "*"
  RETVAL=$?
  if [ "$RETVAL" != "0" ]; then
    echo "wh assetpack compile --onlyfailed failed with errorcode $RETVAL"
    FAILED=1
  fi
fi

exit $FAILED

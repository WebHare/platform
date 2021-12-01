source $WEBHARE_DIR/lib/wh-functions.sh

if [ "$1" != "get" ]; then
  #Forward it to the whscript... we only handle 'get'
  exec_runscript mod::system/scripts/whcommands/module.whscr "$@"
fi

shift #Remove "get"

while [[ $1 =~ --.* ]]; do
  case $1 in
  "--key")
    shift
    if [ -n "$1" -a -f "$1" ]; then
      [ "$WH_VERBOSE" == "1" ] && echo "Using SSH key at $1"
      export GIT_SSH_COMMAND="ssh -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no -i $1"
    else
      echo "Could not find key '$1'"
      exit 1
    fi
    shift
  ;;

  *)
    echo "Illegal option $1"
    exit 1
    ;;
  esac
done

if [ -z "$1" ]; then
  echo "Specify a module name"
  exit 1
fi

ERROR=0

getwhparameters

NEWMODULES=""
while [ -n "$1" ]; do
  CLONEURL="$1"

  # Simply take the last two path compontents of whatever is thrown at us if it ends in .git
  if [[ $CLONEURL =~ .*[/:]([^/:]+)/([^/]+)\.git$ ]]; then
    MODULENAME="${BASH_REMATCH[2]}"
    PATHNAME="${BASH_REMATCH[1]}/${BASH_REMATCH[2]}"
  else
    echo Do not understand URL "$CLONEURL"
    exit 1
  fi

  [ "$WH_VERBOSE" == "1" ] && echo "Cloning module '$MODULENAME' from '$CLONEURL' into '$PATHNAME'"
  if getmoduledir_nofail XXXTEMP $MODULENAME ; then
    echo "The module '$MODULENAME' already exists in $XXXTEMP"
  else
    if [ -z "$WEBHARE_GITMODULES" ]; then
      TARGETDIR=`echo "$WEBHARE_DATAROOT/installedmodules/$PATHNAME" | tr '[:upper:]' '[:lower:]'`
    else
      TARGETDIR=`echo "$WEBHARE_GITMODULES/$PATHNAME" | tr '[:upper:]' '[:lower:]'`
    fi

    mkdir -p "$(dirname "$TARGETDIR")"
    git clone --recurse-submodules "$CLONEURL" "$TARGETDIR"
    ERRORCODE="$?"
    if [ "$ERRORCODE" != "0" ]; then
      echo "Error cloning module, git exited with code $ERRORCODE"
      ERROR=1
    else
      NEWMODULES="$NEWMODULES $MODULENAME"
    fi
  fi
  shift
done

for MOD in $NEWMODULES ; do
  if is_webhare_running ; then
    echo "Activating module '$MOD'"
    wh apply "mod::$MOD/moduledefinition.xml"
  fi
  echo "Fixing module '$MOD'"
  $WEBHARE_DIR/bin/wh fixmodules "$MOD"
done

exit $ERROR

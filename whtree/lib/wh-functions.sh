loadshellconfig()
{
  if [ -n "$LOADEDSHELLCONFIG" ]; then
    return;
  fi
  FILENAME="`mktemp /tmp/wh.XXXXXXXXXXXXX`"
  if ! runscript mod::system/scripts/whcommands/shellconfig.whscr > $FILENAME ; then
    exit 1
  fi
  source $FILENAME
  rm -- $FILENAME
  LOADEDSHELLCONFIG=1
}

loadenvsettings()
{
  getwhparameters
  if [ -f $WEBHARE_DATAROOT/.webhare-envsettings.sh ]; then
    . $WEBHARE_DATAROOT/.webhare-envsettings.sh
  fi
}

runscript()
{
  loadenvsettings
  $WEBHARE_DIR/bin/runscript "$@"
}

getwhparameters()
{
  if [ ! -x "$WEBHARE_DIR/bin/webhare" ]; then
    echo "This command needs an installed (make install) WebHare, but $WEBHARE_DIR/bin/webhare appears unavailable"
    exit 1
  fi
  eval `$WEBHARE_DIR/bin/webhare printparameters`
  if [ -z "$WEBHARE_DBASENAME" ]; then
    export STORAGEPATH="$WEBHARE_DATAROOT/dbase"
    export RECORDSTORAGEPATH="$WEBHARE_DATAROOT/dbase"
    export INDEXSTORAGEPATH="$WEBHARE_DATAROOT/dbase"
  else
    export STORAGEPATH="$WEBHARE_DATAROOT/postgresql"
    export RECORDSTORAGEPATH=
    export INDEXSTORAGEPATH=
  fi
}

getmoduledir_nofail()
{
  local XXMODULEDIR RESTPATH

  RESTPATH=${2#*/}
  MODULENAME=${2%%/*}

  # Check if the name is a valid modulename
  if ! [[ $MODULENAME =~ ^[a-zA-Z0-9_-]*$ ]]; then
    return 1
  fi

  loadshellconfig
  # this isactually unreliable whenever odd chars appear in $MODULENAME, eg a '-', so we need the name validation check

  # Replace '-' with __dash__
  MODULENAME=${MODULENAME//-/__dash__}

  eval "XXMODULEDIR=\${WEBHARE_CFG_MODULEDIR_$MODULENAME}"
  if [ -n "$XXMODULEDIR" ]; then
    if [ "$RESTPATH" != "$2" -a -n "$RESTPATH" ]; then
      XXMODULEDIR="$XXMODULEDIR$RESTPATH"
    fi
    eval $1=\$XXMODULEDIR
    return 0
  fi
  return 1
}

getmoduledir()
{
  local XMODULEDIR

  if [ -z "$2" ]; then
    echo "Specify a module name" 1>&2
    return
  fi
  if ! getmoduledir_nofail XMODULEDIR "$2" ; then
    echo "No such module $2" 1>&2
    exit 1
  fi
  eval $1=\$XMODULEDIR
  return 0
}

list_coremodules()
{
  local XMODULES

  XMODULES=$(cd ~/projects/webhare/whtree/modules ; ls)
  eval $1=\$XMODULES
  return 0
}

get_installable_moduledirs()
{
  local XDIRS

  if [ -d "$WEBHARE_DATAROOT"/installedmodules ]; then
    XDIRS=$WEBHARE_DATAROOT/installedmodules/*\ $WEBHARE_DATAROOT/installedmodules/*/*
  fi

  if [ -n "$WEBHARE_GITMODULES" -a -d "$WEBHARE_GITMODULES" ]; then
    XDIRS=$XDIRS\ $WEBHARE_GITMODULES/*\ $WEBHARE_GITMODULES/*/*
  fi

  if [ -n "$WEBHARE_GITPACKAGES" -a -d "$WEBHARE_GITPACKAGES" ]; then
    XDIRS=$XDIRS\ $WEBHARE_GITPACKAGES/*\ $WEBHARE_GITPACKAGES/*/*
  fi

  eval $1=\$XDIRS
  return 0
}

setup_node()
{
  getwhparameters
  mkdir -p $WEBHARE_DATAROOT/nodejs
  export NODE_PATH=$WEBHARE_DIR/node_modules:$WEBHARE_DATAROOT/nodejs/node_modules
  export NODE_REPL_HISTORY=$WEBHARE_DATAROOT/nodejs/.repl-history
  # workaround openssl/nodegit issues by using the homebrew version if available. FIXME removethis when setupdev branch is merged
  export LDFLAGS=-L/usr/local/opt/openssl/lib/
  export CFLAGS=-I/usr/local/opt/openssl/include
  export WEBHARE_LOOPBACKPORT
}

noderun()
{
  PACKAGE=$1
  shift
  for P in "$WEBHARE_DATAROOT/nodejs/node_modules/.bin" "$WEBHARE_DIR/node_modules/.bin" ]; do
    if [ -f "$P/$PACKAGE" ]; then
      if [ "$NOEXEC" == "1" ]; then
        node "$P/$PACKAGE" "$@"
        return $?
      else
        exec node "$P/$PACKAGE" "$@"
      fi
    fi
  done
  echo "Package '$PACKAGE' not found"
  exit 1
}

getlog()
{
  local XLOGFILE LOGFILEPATH
  getwhparameters
  if [ -z "$LOGFILEPATH" ]; then
    echo "Unable to determine logging path"
    exit 1
  fi
  XLOGFILE="${LOGFILEPATH}$2.$LOGFILETODAY.log"
  if [ ! -f "$XLOGFILE" ]; then
    echo "Unable to open logfile $XLOGFILE"
    exit 1
  fi

  eval $1=\$XLOGFILE
  return 0
}

exec_runscript()
{
  loadenvsettings
  exec $WEBHARE_DIR/bin/runscript "$@"
  exit 255
}

get_webhare_pid()
{
  local XPID
  XPID="`cat "$WEBHARE_DATAROOT"/.webhare.pid < /dev/null 2>/dev/null`"
  eval $1=\$XPID
}

is_webhare_running()
{
  # Check if WebHare is up
  local PID
  get_webhare_pid PID
  if [ -n "$PID" ]; then
    if [ "$WHBUILD_PLATFORM" == "darwin" ]; then
      if [ "`ps -o command= -cp $PID`" == "webhare" ]; then
        return 0 #running
      fi
    else # linux does not like the '-' in '-cp'
      if [ "`ps -o command= cp $PID`" == "webhare" ]; then
        return 0 #running
      fi
    fi
  fi
  return 1
}


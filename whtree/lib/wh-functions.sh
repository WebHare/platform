getbaseversioninfo()
{
  local WHNUMERICVERSION
  WHNUMERICVERSION=`(awk -- '/define BLEX_BRANDING_PRODUCT_VERSION_NUMBER / { print $3 }' < $WEBHARE_CHECKEDOUT_TO/blex/branding.h)`
  if [ -z "$WHNUMERICVERSION" ]; then
    echo "Unable to retrieve version # from branding.h"
    exit 1
  fi

  WEBHARE_VERSION=${WHNUMERICVERSION:0:1}.$((${WHNUMERICVERSION:1:2})).$((${WHNUMERICVERSION:3:2}))
}

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
  local XXMODULEDIR RESTPATH MODULENAME

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

# Get absolute path
get_absolute_path()
{
  if [ -d "$1" ]; then
    echo "$(cd "$1" && pwd)"
  else
    echo "$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
  fi
}

trim()
{
    local var="$*"
    # remove leading whitespace characters
    var="${var#"${var%%[![:space:]]*}"}"
    # remove trailing whitespace characters
    var="${var%"${var##*[![:space:]]}"}"
    echo -n "$var"
}

# Calculate the image tags for the build/test/deploy process
# return
#   BUILD_IMAGE name of the Webhare image
#   BRANCH_IMAGES image tags with shortcuts for the branch
#   PUBLIC_IMAGES image tags that will be deployed
#   PUSH_BUILD_IMAGES if 1, push build and branch images
get_finaltag()
{
  BUILD_IMAGE=
  BRANCH_IMAGES=
  PUBLIC_IMAGES=
  PUSH_BUILD_IMAGES=

  local MAINTAG
  getbaseversioninfo

  # are we running on CI?
  if [ -n "$CI_COMMIT_SHA" ]; then

    # CI may push images to the CI repos
    PUSH_BUILD_IMAGES=1

    if [ "$CI_COMMIT_TAG" != "" ]; then
      if ! [[ $CI_COMMIT_TAG =~ ^[0-9]+\.[0-9]+\.[0-9]$ ]]; then
        echo "I do not understand the commit tag: $CI_COMMIT_TAG"
        exit 1
      fi

      # we are building a specific tag, eg 4.28.0. git tag == docker tag == calculated semantic version
      MAINTAG=$CI_COMMIT_TAG
      if [ "$MAINTAG" != "$WEBHARE_VERSION" ]; then
        echo "Expected to be tagged '$WEBHARE_VERSION' but the tag was '$MAINTAG'"
        exit 1
      fi
    else
      MAINTAG="$CI_COMMIT_REF_SLUG"

      if [ "${CI_COMMIT_REF_NAME:0:7}" == "custom/" ]; then
        # Custom builds - these are specifically tagged after their branch. eg branch custom/myserver with numeric version 42702 will have semver: 4.27.2-myserver
        WEBHARE_VERSION="${WEBHARE_VERSION}-${CI_COMMIT_REF_NAME:7}"
      else
        # Other branches are simply considered 'in development' and have prerelease tag '-dev', eg. 4.27.2-dev
        WEBHARE_VERSION=${WEBHARE_VERSION}-dev
      fi
    fi

    # check if there is a CI registry
    if [ -z "$CI_REGISTRY_IMAGE" ]; then
      echo "The CI_REGISTRY_IMAGE variable is not set, please enable the containter registry for this project"
      exit 1
    fi

    BUILD_IMAGE="$CI_REGISTRY_IMAGE:$MAINTAG-$CI_COMMIT_SHA"

    BRANCH_IMAGES="$(trim $BRANCH_IMAGES $CI_REGISTRY_IMAGE:$MAINTAG)"

    if [ -n "$PUBLIC_REGISTRY_IMAGE" ]; then # PUBLIC_REGISTRY_IMAGE is only set for protected branches/tags
      PUBLIC_IMAGES="$(trim $PUBLIC_IMAGES $PUBLIC_REGISTRY_IMAGE:$MAINTAG)"
    fi
  else
    # local build. No pushes or deploys

    BUILD_IMAGE="webhare/webhare-extern:localbuild${WEBHARE_LOCALBUILDIMAGEPOSTFIX}"
    WEBHARE_VERSION=${WEBHARE_VERSION}-dev
  fi

  echo "Semantic version:     $WEBHARE_VERSION"
  echo ""
  echo "Building images with tags:"
  echo "BUILD_IMAGE=          $BUILD_IMAGE"
  echo ""
  echo "Pushing images to CI registry:"
  echo "PUSH_BUILD_IMAGES=    $PUSH_BUILD_IMAGES"
  echo ""
  echo "Branch shortcuts, to be pushed to CI registry:"
  echo "BRANCH_IMAGES=        $BRANCH_IMAGES"
  echo ""
  echo "Images to be deployed after tests succeed"
  echo "PUBLIC_IMAGES=        $PUBLIC_IMAGES"
  echo ""

  if [ -n "$PUBLIC_IMAGES" ]; then
    if [ -z "$DOCKERHUB_REGISTRY_USER" ]; then
      echo "Public images set but no DOCKERHUB_REGISTRY_USER environment received - deploy will fail"
      exit 1
    fi
    if [ -z "$DOCKERHUB_REGISTRY_PASSWORD" ]; then
      echo "Public images set but no DOCKERHUB_REGISTRY_PASSWORD environment received - deploy will fail"
      exit 1
    fi
  fi
}

# Version compare
function version_gte() { test "$(printf '%s\n' "$@" | sort -V | head -n 1)" == "$2"; }

c()
{
  RESULT=
  while [ -n "$*" ]; do
    case "$1" in
      reset) RESULT="$RESULT\x1b[0m";;
      bold) RESULT="$RESULT\x1b[1m";;
      black) RESULT="$RESULT\x1b[30m";;
      red) RESULT="$RESULT\x1b[31m";;
      green) RESULT="$RESULT\x1b[32m";;
      yellow) RESULT="$RESULT\x1b[33m";;
      blue) RESULT="$RESULT\x1b[34m";;
      magenta) RESULT="$RESULT\x1b[35m";;
      cyan) RESULT="$RESULT\x1b[36m";;
      grey) RESULT="$RESULT\x1b[37m";;
      white) RESULT="$RESULT\x1b[97m";;
      bblack) RESULT="$RESULT\x1b[40m";;
      bred) RESULT="$RESULT\x1b[41m";;
      bgreen) RESULT="$RESULT\x1b[42m";;
      byellow) RESULT="$RESULT\x1b[43m";;
      bblue) RESULT="$RESULT\x1b[44m";;
      bmagenta) RESULT="$RESULT\x1b[45m";;
      bcyan) RESULT="$RESULT\x1b[46m";;
      bgrey) RESULT="$RESULT\x1b[47m";;
      bwhite) RESULT="$RESULT\x1b[107m";;
    esac
    shift;
  done
  echo -e "$RESULT"
}

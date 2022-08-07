# This script is also deployed to https://build.webhare.dev/ci/scripts/wh-functions.sh

estimate_buildj()
{
  if [ -n "$WHBUILD_NUMPROC" ]; then
    return
  fi

  if [ "$WHBUILD_PLATFORM" == "darwin" ]; then
    WHBUILD_NUMPROC=$(( `sysctl hw.ncpu | cut -d":" -f2` + 1 ))
  elif [ "$WHBUILD_PLATFORM" == "linux" ]; then
    WHBUILD_NUMPROC=`LANG=en_US.utf8 lscpu 2>/dev/null | grep "^CPU(s):" | cut -d: -f2` #2>/dev/null because centos 5 util-linux does not include lscpu
    MAXPROC=$(( `cat /proc/meminfo | grep ^MemTotal | cut -b10-24` / 1024000 ))
    if [ -z "$WHBUILD_NUMPROC" ]; then
      WHBUILD_NUMPROC=4
    elif [ $WHBUILD_NUMPROC -gt $MAXPROC ]; then
      WHBUILD_NUMPROC=$MAXPROC
    fi
  else
    echo "Unable to estimate proper build flags"
    exit 1
  fi
}

export -f estimate_buildj

getbaseversioninfo()
{
  local WHNUMERICVERSION
  if [ -n "$__MOCK_WHNUMERICVERSION" ]; then
    WHNUMERICVERSION="$__MOCK_WHNUMERICVERSION"
  else
    WHNUMERICVERSION=`(awk -- '/define BLEX_BRANDING_PRODUCT_VERSION_NUMBER / { print $3 }' < $WEBHARE_CHECKEDOUT_TO/blex/branding.h)`
    if [ -z "$WHNUMERICVERSION" ]; then
      echo "Unable to retrieve version # from branding.h"
      exit 1
    fi
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
  export WEBHARE_DATABASEPATH="$WEBHARE_DATAROOT/postgresql"
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
    if [ "$2" == "dev" ]; then
      echo "No such module $2 - please see https://www.webhare.dev/manuals/developers/dev-module/" 1>&2
    else
      echo "No such module $2" 1>&2
    fi
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

die()
{
  echo "$@" 1>&2
  exit 1
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
  local ADDTAGS
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

    # When building 'master', also build the corresponding release-x-y tag
    if [ "$MAINTAG" == "master" ]; then
    echo $WEBHARE_VERSION
      ADDTAGS="release-$(echo "$WEBHARE_VERSION" | cut -d. -f1)-$(echo "$WEBHARE_VERSION" | cut -d. -f2)"
    fi

    BUILD_IMAGE="$CI_REGISTRY_IMAGE:$MAINTAG-$CI_COMMIT_SHA"

    BRANCH_IMAGES="$(trim $BRANCH_IMAGES $CI_REGISTRY_IMAGE:$MAINTAG)"

    local TAG
    for TAG in $MAINTAG $ADDTAGS; do
      if [ -n "$PUBLIC_REGISTRY_IMAGE" ]; then # PUBLIC_REGISTRY_IMAGE is only set for protected branches/tags
        PUBLIC_IMAGES="$(trim $PUBLIC_IMAGES $PUBLIC_REGISTRY_IMAGE:$TAG)"
      fi

      if [ -n "$FALLBACK_REGISTRY_IMAGE" ]; then # FALLBACK_REGISTRY_IMAGE is only set for protected branches/tags
        PUBLIC_IMAGES="$(trim $PUBLIC_IMAGES $FALLBACK_REGISTRY_IMAGE:$TAG)"
      fi
    done
  else
    # local build. No pushes or deploys

    BUILD_IMAGE="webhare/webhare-extern:localbuild${WEBHARE_LOCALBUILDIMAGEPOSTFIX}"
    WEBHARE_VERSION=${WEBHARE_VERSION}-dev
  fi

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

list_finaltag()
{

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

# Initialize COMP_WORDS, COMP_CWORD and COMPREPLY. Split on whitespace only, ignoring COMP_WORDBREAKS
autocomplete_init_compwords()
{
  # Parse COMP_LINE, split on whitespace only. Append a char to make sure trailing whitespace isn't lost
  if [ -n "$COMP_POINT" ]; then
    read -r -a COMP_WORDS <<< "${COMP_LINE:0:$COMP_POINT}z"
  else
    read -r -a COMP_WORDS <<< "${COMP_LINE}z"
  fi
  # Find last word and remove the added char from it
  COMP_CWORD=$(( ${#COMP_WORDS[@]} - 1))
  COMP_WORDS[$COMP_CWORD]=${COMP_WORDS[$COMP_CWORD]:0:${#COMP_WORDS[$COMP_CWORD]}-1}
  # Make sure COMPREPLY is initialized
  COMPREPLY=()
}

# Print all matches from COMPREPLY, but only those that don't change stuff left to the cursor
autocomplete_print_compreply()
{
  local LASTWORD_PARTS LASTWORD_LASTPART STRIP_CHARS PREFIX
  # Parse the last word using the COMP_WORDBREAKS, append a char to detect stuff ending on a word break
  IFS="$COMP_WORDBREAKS" read -r -a LASTWORD_PARTS <<< "${COMP_WORDS[$COMP_CWORD]}z"
  # And remove that added character again
  LASTWORD_LASTPART=${LASTWORD_PARTS[${#LASTWORD_PARTS[@]}-1]}
  # calc how many characters from the last word won't be replaced by the shell
  STRIP_CHARS=$((${#COMP_WORDS[$COMP_CWORD]} - ${#LASTWORD_LASTPART} + 1))
  # Make sure we only let suggestions through that append (not those that change stuff left to the cursor)
  TESTLEN=${#COMP_WORDS[$COMP_CWORD]}
  PREFIX="${COMP_WORDS[$COMP_CWORD]:0:TESTLEN}"
  for i in "${COMPREPLY[@]}"; do
    if [ "${i:0:$TESTLEN}" == "$PREFIX" ]; then
      echo "${i:$STRIP_CHARS}"
    fi
  done
}

vercomp () {
  # Based on https://stackoverflow.com/questions/4023830/how-compare-two-strings-in-dot-separated-version-format-in-bash
  # Extend with the WebHare approach to -xyz tags (5.0.2-xyz <= 5.0.2, no opinion about 5.0.2-xyz vs 5.0.2-dev)
  if [[ $1 == $2 ]]
  then
      return 0
  fi
  local IFS=.
  local i ver1=($1) ver2=($2)
  # fill empty fields in ver1 with zeros
  for ((i=${#ver1[@]}; i<${#ver2[@]}; i++))
  do
      ver1[i]=0
  done
  #echo VERCOMP APRTS 1: ${ver1[*]}
  #echo VERCOMP APRTS 2: ${ver2[*]}
  for ((i=0; i<${#ver1[@]}; i++))
  do
      if [[ -z ${ver2[i]} ]]
      then
          # fill empty fields in ver2 with zeros
          ver2[i]=0
      fi
      if ((10#${ver1[i]} > 10#${ver2[i]}))
      then
          return 1 #ver1 (LHS) is NEWER than ver2
      fi
      if ((10#${ver1[i]} < 10#${ver2[i]}))
      then
          return 2
      fi
  done

  local lastver1=${ver1[${#ver1[@]} - 1]}
  local lastver2=${ver2[${#ver2[@]} - 1]}

  if [[ $lastver2 =~ - ]] && ! [[ $lastver1 =~ - ]] ; then #Comparing 1.2.3 to 1.2.3-xyz
    return 1 #ver1 (without a -xxx) is thus newer than ver2
  fi
  if [[ $lastver1 =~ - ]] && ! [[ $lastver2 =~ - ]] ; then #Comparing 1.2.3-xyz to 1.2.3
    return 2 #ver1 is older
  fi

  return 0
}

verify_webhare_version()
{
  PREVVER="$1"
  CURVER="$2"

  [ "$PREVVER" == "$CURVER" ] && return 0

  vercomp "$PREVVER" "$CURVER"
  if [ "$?" == "1" ]; then # PREVVER > CURVER
    echo "Previous WebHare version '$PREVVER' is newer than this WebHare version '$CURVER' - downgrading is never safe"
    return 1
  fi

  vercomp "$CURVER" 5.0.0-dev
  if [ "$?" != "2" ]; then # CURVER >= 5.0.0-dev (we should know which version we are, but this is useful for test coverage)
    # 4.35 was unskippable for 5.0.0
    vercomp "4.35.0" "$PREVVER"
    if [ "$?" == "1" ]; then # 4.35.0 > PREVVER
      echo "Previous WebHare version '$PREVVER' is older than 4.35.0 - you cannot skip 4.35.xx between 4.34 and 5.0!"
      return 1
    fi
  fi

  return 0
}


#!/bin/bash

# This script is also deployed to https://build.webhare.dev/ci/scripts/wh-functions.sh

source "${BASH_SOURCE%/*}/make-functions.sh"

logWithTime()
{
  local now
  if [[ "$OSTYPE" == "darwin"* ]]; then  #mac doesn't support .%3N
    now=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
  else
    now=$(date -u +'%Y-%m-%dT%H:%M:%S.%3NZ')
  fi

  echo "[$now]" "$1"
}

testEq()
{
  if [ "$1" != "$2" ]; then
    echo "** TEST FAILED"
    echo "Expected: $1"
    echo "Got:      $2"
    echo ""
    exit 1
  fi
}

wh_getnodeconfig() # Discover node binary. Note that as WH is now started by a servicemanager.ts, they will all inherit the discovered setting
{
  if [ -z "$WEBHARE_NODE_MAJOR" ]; then # Not locked in the (docker) environment
    WEBHARE_NODE_MAJOR="$(grep ^node_major= "$WEBHARE_DIR/etc/platform.conf" | cut -d= -f2)"
    [ -n "$WEBHARE_NODE_MAJOR" ] || die "Could not set WEBHARE_NODE_MAJOR from $WEBHARE_DIR/etc/platform.conf"
  fi

  if [ "$WEBHARE_PLATFORM" == "darwin" ] && [ -x "$(brew --prefix)/opt/node@${WEBHARE_NODE_MAJOR}/bin/node" ]; then
    WEBHARE_NODE_BINARY="$(brew --prefix)/opt/node@${WEBHARE_NODE_MAJOR}/bin/node"
  fi
  [ -n "$WEBHARE_NODE_BINARY" ] || WEBHARE_NODE_BINARY="node"

  export WEBHARE_NODE_MAJOR WEBHARE_NODE_BINARY
}

# run a JS/TS script, assumes the resolveplugin is ready for use
wh_runjs()
{
  local ARGS RETVAL
  ARGS=("$@")

  getwhparameters

  # is the 'jsprofile' flag set ?
  if [[ $WEBHARE_DEBUG =~ ((^|[,])jsprofile([,]|$))+ ]] ; then
    # prefix with profile starter. note that this for now just prints some simple stats to stdout (and is not compatible with nodejs --prof/--prof-process - but much faster)
    ARGS=("$WEBHARE_DIR/modules/system/js/internal/debug/jsprofile.ts" "${ARGS[@]}")
  fi

  # avoid side effects if other scripts invoke node (eg 'wh make' and its postinstall)
  SAVE_NODE_PATH="$NODE_PATH"
  SAVE_NODE_OPTIONS="$NODE_OPTIONS"

  export NODE_PATH="$WEBHARE_DATAROOT/node_modules"
  export NODE_OPTIONS="--trace-warnings --enable-source-maps --require \"$WEBHARE_DIR/jssdk/tsrun/dist/resolveplugin.js\" --require "@mod-platform/js/bootstrap/whnode-preload" --openssl-legacy-provider $NODE_OPTIONS"

  # is the 'retainers' flag set ?
  if [[ $WEBHARE_DEBUG =~ ((^|[,])retainers([,]|$))+ ]] ; then
    NODE_OPTIONS="--require \"$WEBHARE_DIR/modules/system/js/internal/debug/retainers.js\" $NODE_OPTIONS"
  fi

  [ -n "$WEBHARE_NODE_BINARY" ] || wh_getnodeconfig

  # --experimental-wasm-stack-switching is not allowed in NODE_OPTIONS
  "${RUNPREFIX[@]}" "${WEBHARE_NODE_BINARY}" --experimental-wasm-stack-switching $WEBHARE_NODE_OPTIONS "${ARGS[@]}"
  RETVAL="$?"

  NODE_PATH="$SAVE_NODE_PATH"
  NODE_OPTIONS="$SAVE_NODE_OPTIONS"

  return $RETVAL
}

exec_wh_runjs()
{
  RUNPREFIX=(exec)
  wh_runjs "$@"
  echo "wh node: the actual node binary was not found" 1>&2
  exit 255
}

loadshellconfig()
{
  if [ -n "$LOADEDSHELLCONFIG" ]; then
    return;
  fi

  # Ignore WEBHARE_NODE_OPTIONS when running getshellconfig.ts (NODE_OPTIONS is still honored) so we're not eg. inspecting the wrong process
  SHELLCONFIG="$(WEBHARE_NODE_OPTIONS= wh_runjs "$WEBHARE_DIR/modules/platform/js/bootstrap/getshellconfig.ts")"
  [ "$?" == "0" ] || die "shellconfig failed"

  eval "$SHELLCONFIG"
  LOADEDSHELLCONFIG=1
}

getwhparameters()
{
  if [ "$GOTWHPARAMETERS" = "1" ]; then
    return
  fi
  if [ -z "${WEBHARE_DATAROOT}" ]; then
    echo WEBHARE_DATAROOT not set
    exit 1
  fi

  [ -n "$WEBHARE_COMPILECACHE" ] || export WEBHARE_COMPILECACHE="${WEBHARE_DATAROOT}/ephemeral/compilecache/"
  export WEBHARE_TSBUILDCACHE="${WEBHARE_COMPILECACHE}/typescript"
  export WEBHARE_DATABASEPATH="${WEBHARE_DATAROOT}/postgresql"

  if [ -f "$WEBHARE_DATAROOT/webhare.restoremode" ]; then
    WEBHARE_ISRESTORED="$(cat "$WEBHARE_DATAROOT/webhare.restoremode")"
    [ -n "$WEBHARE_ISRESTORED" ] || WEBHARE_ISRESTORED="1" #'1' marks us as restored without further info
    export WEBHARE_ISRESTORED
  fi

  if [ -f "$WEBHARE_DATAROOT/webhare.readonlymode" ]; then
    WEBHARE_DBASE_READONLY="$(cat "$WEBHARE_DATAROOT/webhare.readonlymode")"
    [ -n "$WEBHARE_DBASE_READONLY" ] || WEBHARE_DBASE_READONLY="1" #'1' marks us as restored without further info
    export WEBHARE_DBASE_READONLY
  fi

  GOTWHPARAMETERS=1
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

resolveresourcepath ()
{
  local FINALPATH MODNAME MODPATH
  FINALPATH=$2
  if [[ $FINALPATH =~ ^mod::.+/.*$ ]]; then
    MODNAME=${FINALPATH%%/*}
    MODNAME=${MODNAME:5}
    getmoduledir MODPATH "$MODNAME"
    if [ -z "$MODPATH" ]; then
        FINALPATH=
    else
        FINALPATH="${MODPATH}${FINALPATH#*/}"
    fi
  fi
  eval $1=\$FINALPATH
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

calc_dir_relpath()
{
  local base target result
  base="x$2"
  base="${base//\/\//\/}"
  base="${base%/}"
  target="x$3"
  target="${target//\/\//\/}"
  target="${target%/}/"
  result=
  while [[ "${target#$base}/" == "$target/" ]]; do
    base="$(dirname "$base")"
    result="$result../"
  done
  eval $1="\${result}\${target#\$base/}"
  WEBHARE_DIR_RELATIVE="${result}${target#$base/}"
}

getlog()
{
  local XLOGFILE
  XLOGFILE="${WEBHARE_DATAROOT}/log/$2.$(TZ=UTC date +%Y%m%d).log"
  if [ ! -f "$XLOGFILE" ]; then
    echo "Unable to open logfile $XLOGFILE"
    exit 1
  fi

  eval $1=\$XLOGFILE
  return 0
}

is_wasmengine()
{
  local TOTEST
  TOTEST="$1"
  if [[ $TOTEST =~ .*\<\?wh.*\(\*WASMENGINE\*\) ]]; then
    return 0
  fi
  return 1
}

wh_runwhscr()
{
  local RESOLVEDPATH FIRSTLINE

  getwhparameters
  resolveresourcepath RESOLVEDPATH "$1"

  # we use a heuristic to detect the (*WASMENGINE*) text. we can make this a bit more robust but why are you fighting us anyway :-)
  read -r FIRSTLINE < "$RESOLVEDPATH"
  if is_wasmengine "$FIRSTLINE"; then
    #wh_runjs will honor any RUNPREFIX
    wh_runjs "$WEBHARE_DIR/modules/system/scripts/whcommands/runwasm.ts" "$@"
  else
    "${RUNPREFIX[@]}" $WEBHARE_DIR/bin/runscript --workerthreads 4 "$@"
  fi
}

exec_wh_runwhscr()
{
  RUNPREFIX=(exec)
  wh_runwhscr "$@"
  exit 255
}

runscript()
{
  getwhparameters
  "${RUNPREFIX[@]}" $WEBHARE_DIR/bin/runscript "$@"
}

exec_runscript()
{
  RUNPREFIX=(exec)
  runscript "$@"
  exit 255
}

get_webhare_pid()
{
  local XPID
  XPID="$(cat "$WEBHARE_DATAROOT"/.webhare.pid < /dev/null 2>/dev/null)"
  eval "$1"=\$XPID
}

is_webhare_running()
{
  # Check if WebHare is up
  local PID
  get_webhare_pid PID
  if [ -n "$PID" ]; then
    if [ "$WEBHARE_PLATFORM" == "darwin" ]; then
      PROCESSNAME="$(ps -o command= -cp "$PID")"
    else # linux does not like the '-' in '-cp'
      PROCESSNAME="$(ps -o command= cp "$PID")"
    fi

    # Our master process is either 'node' or 'webhare'. But on linux the renamed process title is picked up, so look for webhare: too
    if [ "$PROCESSNAME" == "node" ] || [ "$PROCESSNAME" == "webhare" ] || [ "${PROCESSNAME:0:8}" == "webhare:" ]; then
      return 0 #running
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

  local ADDTAGS
  getwebhareversion

  if [[ $WEBHARE_VERSION =~ ^([0-9]{1})\.([0-9]{1,2})\.([0-9]{1,2})$ ]]; then
    VERSIONMAJOR="${BASH_REMATCH[1]}"
    VERSIONMINOR="${BASH_REMATCH[2]}"
    VERSIONPATCH="${BASH_REMATCH[3]}"
    VERSIONPADDEDMINOR="VERSIONMINOR"
    VERSIONPADDEDPATCH="VERSIONPATCH"
    # leftpad with a zero
    [ ${#VERSIONPADDEDMINOR} = 2 ] || VERSIONPADDEDMINOR="0${VERSIONPADDEDMINOR}"
    [ ${#VERSIONPADDEDPATCH} = 2 ] || VERSIONPADDEDPATCH="0${VERSIONPADDEDPATCH}"
  else
    die "Could not parse version number $WEBHARE_VERSION"
  fi

  # are we running on CI?
  if [ -n "$CI_COMMIT_SHA" ]; then

    # CI may push images to the CI repos
    PUSH_BUILD_IMAGES=1

    if [ "$CI_COMMIT_TAG" != "" ]; then
      echo "We should no longer build on tag push!"
      exit 1
    fi

    # check if there is a CI registry
    if [ -z "$CI_REGISTRY_IMAGE" ]; then
      echo "The CI_REGISTRY_IMAGE variable is not set, please enable the containter registry for this project"
      exit 1
    fi

    # When building 'master', also build the corresponding release-x-y tag
    if [ "$CI_COMMIT_REF_NAME" == "master" ]; then
      ADDTAGS="release-$(echo "$WEBHARE_VERSION" | cut -d. -f1)-$(echo "$WEBHARE_VERSION" | cut -d. -f2)"
    fi

    # When building 'master' or a 'release/', also tag by WebHare version# (eg 4.35.2)
    if [ "$CI_COMMIT_REF_NAME" == "master" ] || [[ $CI_COMMIT_REF_NAME =~ ^release/ ]]; then #not a custom/feature build
      ADDTAGS="$ADDTAGS ${VERSIONMAJOR}.${VERSIONMINOR}.${VERSIONPATCH}"
    fi

    BUILD_IMAGE="$CI_REGISTRY_IMAGE:$CI_COMMIT_REF_SLUG-$CI_COMMIT_SHA"

    BRANCH_IMAGES="$(trim $BRANCH_IMAGES $CI_REGISTRY_IMAGE:$CI_COMMIT_REF_SLUG)"

    local TAG
    for TAG in $CI_COMMIT_REF_SLUG $ADDTAGS; do
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
    WEBHARE_VERSION=${WEBHARE_VERSION}
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
  if [[ $1 == $2 ]]
  then
      return 0
  fi
  local IFS=.
  # Truncate after first '-' (%%-* truncates after first, %-* truncates after last)
  local ver1number="${1%%-*}" ver2number="${2%%-*}"
  local ver1suffix ver2suffix
  # check if we truncated something, if so, grab the suffix
  [ "$ver1number" != "$1" ] && ver1suffix="-${1#*-}"
  [ "$ver2number" != "$2" ] && ver2suffix="-${2#*-}"

  local i ver1=($ver1number) ver2=($ver2number)

  # fill empty fields in ver1 with zeros
  for ((i=${#ver1[@]}; i<${#ver2[@]}; i++))
  do
      ver1[i]=0
  done

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

  if [[ $ver2suffix =~ - ]] && ! [[ $ver1suffix =~ - ]] ; then #Comparing 1.2.3 to 1.2.3-xyz
    return 1 #ver1 (without a -xxx) is thus newer than ver2
  fi
  if [[ $ver1suffix =~ - ]] && ! [[ $ver2suffix =~ - ]] ; then #Comparing 1.2.3-xyz to 1.2.3
    return 2 #ver1 is older
  fi
  if [[ "$ver1suffix" < "$ver2suffix" ]]; then
    return 2 #ver1 is older
  fi
  if [[ "$ver1suffix" > "$ver2suffix" ]]; then
    return 1 #ver1 is newer
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

setup_buildsystem()
{
  if [ -z "$WEBHARE_IN_DOCKER" ]; then # Not a docker build, configure for local building
    setup_builddir
  fi

  getwebhareversion

  [ -n "$WEBHARE_NODE_BINARY" ] || wh_getnodeconfig

  if [ "$WEBHARE_PLATFORM" == "darwin" ]; then   # Set up darwin. Make sure homebrew and packages are available
    if ! which brew >/dev/null 2>&1 ; then
      echo "On macOS we rely on Homebrew (http://brew.sh) and some additional packages being installed. Please install it"
      exit 1
    fi

    if [ -z "$NOBREW" ]; then
      # Only (re)install homebrew if webhare.rb changed
      DEPSFILE="$WEBHARE_CHECKEDOUT_TO/addons/darwin/webhare-deps.rb"

      # Remove from old location (remove at Date.now >= 2024-02-13)
      [ -f "$WEBHARE_CHECKEDOUT_TO/.checkoutstate/last-brew-install" ] && rm "$WEBHARE_CHECKEDOUT_TO/.checkoutstate/last-brew-install"

      # Store the checkfile in 'whbuild' so discarding that directory (which you should do when changing platforms) resets the brew state too
      CHECKFILE="$WEBHARE_BUILDDIR/last-brew-install"
      if [ "$DEPSFILE" -nt "$CHECKFILE" ] || [ "$WEBHARE_DIR/etc/platform.conf" -nt "$CHECKFILE" ]; then
      export HOMEBREW_WEBHARE_NODE_MAJOR="$WEBHARE_NODE_MAJOR" # homebrew filters most env vars
        echo -n "Brew: "
        if ! brew reinstall --formula "$DEPSFILE" ; then exit ; fi
        echo "$TODAY" > "$CHECKFILE"
      fi
    fi

    if ! which node >/dev/null 2>&1 ; then
      echo "'node' still not available, please install it ('brew link node' or 'brew link node@<version>'?)"
      exit 1
    fi

  elif [ "$WEBHARE_PLATFORM" == "linux" ] && [ -f /etc/redhat-release ] && ! grep CentOS /etc/redhat-release ; then
    REQUIREPACKAGES="openssl-devel pixman-devel git freetype-devel GeoIP-devel libtiff-devel giflib-devel libjpeg-turbo-devel libpng-devel libtiff-devel pixman-devel openssl-devel libicu-devel libxml2-devel valgrind-devel libmaxminddb-devel libpq-devel"
    if ! which ccache > /dev/null 2>&1 ; then
      REQUIREPACKAGES="$REQUIREPACKAGES ccache"
    fi
    MISSINGPACKAGES=
    for P in $REQUIREPACKAGES; do
      ASSUME=0
      for Q in $WEBHARE_ASSUMEPACKAGES ; do
        if [ "$P" == "$Q" ]; then
          ASSUME=1
        fi
      done
      if [ "$ASSUME" == "1" ]; then
        continue
      fi
      if ! rpm -q $P >/dev/null ; then
        MISSINGPACKAGES="$MISSINGPACKAGES $P"
      fi
    done

    if [ -n "$MISSINGPACKAGES" ]; then
      echo ""
      echo "We need to install the following packages:"
      echo "$MISSINGPACKAGES"
      echo ""
      if [ "$WEBHARE_IN_DOCKER" == "1" ]; then
        die "WEBHARE_IN_DOCKER set, aborting build. You probably want to update your Dockerfile"
      fi
      if [ "$FORCE" != "1" ]; then
        echo "If you want me to install them, type YES"
        echo ""
        read answer
        if [ "$answer" != "YES" ]; then
          die "Then I fear you're on your own"
        fi
      fi

      sudo dnf install -y $MISSINGPACKAGES
    fi
  fi

  vercomp "`npm -v`" "$REQUIRENPMVERSION"
  if [ "$?" == "2" ]; then
    echo "You have npm $(npm -v), we desire $REQUIRENPMVERSION or higher"
    echo "You may need to update nodejs or manually install npm (eg npm install -g npm)"
    exit 1
  fi

  if [ -z "$WEBHARE_IN_DOCKER" ]; then # Not a docker build, configure for local building
    # Additional dependencies
    if ! /bin/bash $WEBHARE_CHECKEDOUT_TO/addons/docker-build/setup-pdfbox.sh ; then
      echo "setup-pdfbox failed"
    fi
    if ! /bin/bash $WEBHARE_CHECKEDOUT_TO/addons/docker-build/setup-tika.sh ; then
      echo "setup-tika failed"
    fi
  fi
}

load_postgres_settings()
{
  # Let's start (and setup?) PostgreSQL!
  if [ -z "$WEBHARE_DBASENAME" ]; then
    echo "WEBHARE_DBASENAME name not set"
    exit 1
  fi
  if [ -z "$WEBHARE_DATAROOT" ]; then
    echo "WEBHARE_DATAROOT name not set"
    exit 1
  fi

  # We put everything under a postgresql folder, so we can chown that to ourselves in the future
  PSROOT="${WEBHARE_DATAROOT}postgresql"

  if [ -n "$WEBHARE_IN_DOCKER" ]; then  #TODO should share with recreate-database and postgres-single
    if [ "$(id -u)" == "0" ]; then #don't switch users if we didn't start as root
      RUNAS="chpst -u postgres:whdata"
    fi
    WEBHARE_PGBIN="/usr/lib/postgresql/11/bin/"
  elif [ -z "$WEBHARE_PGBIN" ]; then
    if [ "$WEBHARE_PLATFORM" = "darwin" ]; then
      # Read the version of the PostgreSQL database, fall back to version 13 (as specified in webhare.rb) for new databases
      PGVERSION=$(cat "$PSROOT/db/PG_VERSION" 2>/dev/null)
      if [ -z "${PGVERSION}" ]; then
        PGVERSION=13
      fi
      if [ -x "$(brew --prefix)/opt/postgresql@${PGVERSION}/bin/postmaster" ]; then
        WEBHARE_PGBIN="$(brew --prefix)/opt/postgresql@${PGVERSION}/bin/"
      else
        echo "This database requires postgres version ${PGVERSION}. Please install it (eg. brew install postgresql@${PGVERSION})"
        exit 1
      fi
    else
      WEBHARE_PGBIN="/usr/pgsql-11/bin/"
    fi
  fi

  export PSROOT RUNAS PGVERSION WEBHARE_PGBIN
}

# we need to export getwhparameters because wh_runjs can't find it if externally invoked
export -f setup_buildsystem wh_runjs exec_wh_runjs wh_runwhscr exec_wh_runwhscr getwhparameters wh_getnodeconfig

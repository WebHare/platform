#!/bin/bash

# This script is also deployed to https://build.webhare.dev/ci/scripts/wh-functions.sh

source "${BASH_SOURCE%/*}/make-functions.sh"

function logWithTime()
{
  local now
  if [[ "$OSTYPE" == "darwin"* ]]; then  #mac doesn't support .%3N
    now=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
  else
    now=$(date -u +'%Y-%m-%dT%H:%M:%S.%3NZ')
  fi

  echo "[$now]" "$@" 1>&2
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
  export NODE_OPTIONS="--trace-warnings --require \"$WEBHARE_DIR/jssdk/tsrun/dist/resolveplugin.js\" --require "@mod-platform/js/bootstrap/whnode-preload" --openssl-legacy-provider $NODE_OPTIONS"

  # is the 'retainers' flag set ?
  if [[ $WEBHARE_DEBUG =~ ((^|[,])retainers([,]|$))+ ]] ; then
    NODE_OPTIONS="--require \"$WEBHARE_DIR/modules/system/js/internal/debug/retainers.js\" $NODE_OPTIONS"
  fi

  if [ -z "$WEBHARE_NO_SOURCEMAPS" ]; then
    NODE_OPTIONS="--enable-source-maps $NODE_OPTIONS"
  fi

  wh_getnodeconfig

  # --experimental-wasm-stack-switching is not allowed in NODE_OPTIONS
  "${RUNPREFIX[@]}" node --experimental-wasm-stack-switching $WEBHARE_NODE_OPTIONS "${ARGS[@]}"
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

getwhparameters()
{
  if [ "$GOTWHPARAMETERS" = "1" ]; then
    return
  fi
  if [ -z "${WEBHARE_DATAROOT}" ]; then
    echo WEBHARE_DATAROOT not set
    exit 1
  fi

  if [ -f "$WEBHARE_DATAROOT/webhare.restoremode" ]; then
    WEBHARE_ISRESTORED="$(cat "$WEBHARE_DATAROOT/webhare.restoremode")"
    [ -n "$WEBHARE_ISRESTORED" ] || WEBHARE_ISRESTORED="1" #'1' marks us as restored without further info
    export WEBHARE_ISRESTORED
  fi

  GOTWHPARAMETERS=1
}

function getmoduledir_nofail() {
  local XXMODULEDIR

  if [ -d "$WEBHARE_DIR/modules/$2" ]; then #it's a builtin
    printf -v "$1" "%s" "$WEBHARE_DIR/modules/$2/"
    return 0
  fi

  XXMODULEDIR="$(readlink "$WEBHARE_DATAROOT"/config/mod/"$2")"
  if [ -n "$XXMODULEDIR" ]; then
    printf -v "$1" "%s" "$XXMODULEDIR"
    return 0
  fi
  return 1
}

function getmoduledir() {
  local XMODULEDIR

  if [ -z "$2" ]; then
    echo "Specify a module name" 1>&2
    exit 1
  fi
  if ! getmoduledir_nofail XMODULEDIR "$2" ; then
    echo "No such module $2" 1>&2
    exit 1
  fi
  printf -v "$1" "%s" "$XMODULEDIR"
  return 0
}

function resolveresourcepath() {
  local MODPATH

  if [[ $2 =~ ^mod::([^/]+)/?(.*)?$ ]]; then
    getmoduledir MODPATH "${BASH_REMATCH[1]}"
    printf -v "$1" "%s" "${MODPATH}${BASH_REMATCH[2]}"
  elif [[ $2 =~ ^storage::([^/]+)/?(.*)?$ ]]; then
    printf -v "$1" "%s" "${WEBHARE_DATAROOT}storage/${BASH_REMATCH[1]}/${BASH_REMATCH[2]}"
  else
    printf -v "$1" "%s" "$2"
  fi
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

  WORKERTHREADS=4
  if [ "$1" == "--workerthreads" ]; then
    shift
    WORKERTHREADS="$1"
    shift
  fi

  getwhparameters
  resolveresourcepath RESOLVEDPATH "$1"

  # we use a heuristic to detect the (*WASMENGINE*) text. we can make this a bit more robust but why are you fighting us anyway :-)
  read -r FIRSTLINE < "$RESOLVEDPATH"
  if [ -n "$WEBHARE_HARESCRIPT_WASMONLY" ] || is_wasmengine "$FIRSTLINE"; then
    #wh_runjs will honor any RUNPREFIX
    wh_runjs "$WEBHARE_DIR/modules/system/scripts/whcommands/runwasm.ts" "$@"
  else
    "${RUNPREFIX[@]}" "$WEBHARE_DIR/bin/runscript" --workerthreads "$WORKERTHREADS" "$@"
  fi
}

exec_wh_runwhscr()
{
  RUNPREFIX=(exec)
  wh_runwhscr "$@"
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
    BUILD_IMAGE="localhost/webhare/platform:devbuild"
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
    COMP_SLICED_LINE="${COMP_LINE:0:$COMP_POINT}"
  else
    read -r -a COMP_WORDS <<< "${COMP_LINE}z"
    COMP_SLICED_LINE="${COMP_LINE}"
  fi
  # Find last word and remove the added char from it
  COMP_CWORD=$(( ${#COMP_WORDS[@]} - 1))
  COMP_WORDS[COMP_CWORD]=${COMP_WORDS[$COMP_CWORD]:0:${#COMP_WORDS[$COMP_CWORD]}-1}
  export COMP_SLICED_LINE;

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

  if [ "$1" == "filter" ]; then
    for i in "${COMPREPLY[@]}"; do
      if [ "${i:0:$TESTLEN}" == "$PREFIX" ]; then
        echo "${i:$STRIP_CHARS}"
      fi
    done
  else
    for i in "${COMPREPLY[@]}"; do
      echo "${i:$STRIP_CHARS}"
    done
  fi
}

# we need to export getwhparameters because wh_runjs can't find it if externally invoked
export -f wh_runjs exec_wh_runjs wh_runwhscr exec_wh_runwhscr getwhparameters wh_getnodeconfig wh_getemscriptenversion

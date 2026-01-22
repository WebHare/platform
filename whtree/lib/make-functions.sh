#!/bin/bash
# This script is also deployed to https://build.webhare.dev/ci/scripts/make-functions.sh

# Helper functions shared between build ('make'), CI (testcontainer) and runtime WebHare.

if [[ "$OSTYPE" == "darwin"* ]]; then
  WEBHARE_PLATFORM="darwin"
else
  WEBHARE_PLATFORM="linux"
fi

# We must have $WEBHARE_DIR, pointing to the 'whtree'.
if [ -z "$WEBHARE_DIR" ]; then
  if [ -n "$WEBHARE_CHECKEDOUT_TO" ]; then
    export WEBHARE_DIR="${WEBHARE_CHECKEDOUT_TO%/}/whtree"
  else
    export WEBHARE_DIR="$(cd ${BASH_SOURCE%/*}/..; pwd)"
  fi
fi
# Try to set WEBHARE_CHECKEDOUT_TO from WEBHARE_DIR where possible
if [ -z "$WEBHARE_CHECKEDOUT_TO" ]; then
  if [ -f "$WEBHARE_DIR/../builder/base_makefile" ]; then
    export WEBHARE_CHECKEDOUT_TO="$(cd ${WEBHARE_DIR}/..; pwd)"
  fi
fi

function generatebuildinfo() {
  local BUILDINFO_DIR BUILDINFO_FILE COMMITTAG ORIGIN BRANCH

  [ -n "$WEBHARE_CHECKEDOUT_TO" ] || die WEBHARE_CHECKEDOUT_TO not set
  [ -n "$WEBHARE_VERSION" ] || die WEBHARE_VERSION not set

  BUILDINFO_DIR="${WEBHARE_CHECKEDOUT_TO%/}/whtree/modules/platform/generated/"
  BUILDINFO_FILE="${BUILDINFO_DIR}buildinfo"

  mkdir -p "$BUILDINFO_DIR"

  COMMITTAG="$(git -C "$WEBHARE_CHECKEDOUT_TO" rev-parse HEAD)"

  ORIGIN="$(git -C "$WEBHARE_CHECKEDOUT_TO" config --get remote.origin.url | sed -E 's#(https://[^:/]+):[^@]+@#\1@#')"

  BRANCH="${CI_COMMIT_BRANCH}"
  [ -n "$BRANCH" ] || BRANCH="$(git -C "$WEBHARE_CHECKEDOUT_TO" rev-parse --abbrev-ref HEAD)"

  if [ -n "$WEBHARE_IN_DOCKER" ]; then
    [ -n "$COMMITTAG" ] || die "Could not get commit tag from git in $WEBHARE_CHECKEDOUT_TO"
    [ -n "$ORIGIN" ] || die "Could not get origin from git in $WEBHARE_CHECKEDOUT_TO"
    [ -n "$BRANCH" ] || die "Could not get branch name from git in $WEBHARE_CHECKEDOUT_TO"
  fi

  # GitLab CI checks out the commit as a detached head, so we'll have to rely on the CI_ variables to find the branch name
  # Strip any password from the 'origin'
  cat > "${BUILDINFO_FILE}.tmp" << HERE
committag="${COMMITTAG}"
version="${WEBHARE_VERSION}"
branch="${BRANCH}"
origin="${ORIGIN}"
builddatetime="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
HERE
  mv "${BUILDINFO_FILE}.tmp" "${BUILDINFO_FILE}"
}

die()
{
  echo "$@" 1>&2
  exit 1
}

estimate_buildj()
{
  if [ -n "$WHBUILD_NUMPROC" ]; then
    return
  fi

  if [ "$WEBHARE_PLATFORM" == "darwin" ]; then
    WHBUILD_NUMPROC=$(( `sysctl hw.ncpu | cut -d":" -f2` + 1 ))
  elif [ "$WEBHARE_PLATFORM" == "linux" ]; then
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

wh_getnodeconfig() # Discover node binary. Note that as WH is now started by a servicemanager.ts, they will all inherit the discovered setting
{
  [ -n "$__DONE_GETNODE" ] && return

  if [ -z "$WEBHARE_NODE_MAJOR" ]; then # Not locked in the (docker) environment
    WEBHARE_NODE_MAJOR="$(grep ^node_major= "$WEBHARE_DIR/etc/platform.conf" | cut -d= -f2)"
    [ -n "$WEBHARE_NODE_MAJOR" ] || die "Could not set WEBHARE_NODE_MAJOR from $WEBHARE_DIR/etc/platform.conf"
  fi

  if [ "$WEBHARE_PLATFORM" == "darwin" ]; then
    BREWPREFIX="$(brew --prefix)"
    [ -n "$BREWPREFIX" ] || die "Could not find brew (brew --prefix), is Homebrew properly installed and is 'brew' in the PATH?"
    if [ -x "${BREWPREFIX}/opt/node@${WEBHARE_NODE_MAJOR}/bin/node" ]; then # See if our preferred version is available
      NODEBINPATH="${BREWPREFIX}/opt/node@${WEBHARE_NODE_MAJOR}/bin"

      # prepend "$NODEBINPATH" to PATH if it doesn't start with it
      case "$PATH:" in "${NODEBINPATH}":*) ;; *) export PATH="${NODEBINPATH}:${PATH}" ;; esac
    fi
  fi

  export WEBHARE_NODE_MAJOR
  __DONE_GETNODE=1
}

setup_builddir()
{
  if [ -n "$WHBUILD_DEBUG" ]; then
    WHBUILD_PREFIX=debug-
  else
    WHBUILD_PREFIX=release-
  fi

  if [ -n "$WHBUILD_PROFILE" ]; then
    WHBUILD_PREFIX=${WHBUILD_PREFIX}profile-
  fi

  if [ -z "$WHBUILD_BUILDROOT" ]; then
    [ -n "$WEBHARE_CHECKEDOUT_TO" ] || die WEBHARE_CHECKEDOUT_TO not set
    WHBUILD_BUILDROOT="$(cd $WEBHARE_CHECKEDOUT_TO; cd ..; echo $PWD/whbuild)"
  fi
  if [ -z "$WEBHARE_BUILDDIR" ]; then
    WEBHARE_BUILDDIR="$(cd $WEBHARE_CHECKEDOUT_TO; DIRNAME="${PWD##*/}" ; cd ..; echo $PWD/whbuild/${WHBUILD_PREFIX}${DIRNAME})"
  fi

  if [ -z "$WEBHARE_BUILDDIR" ]; then
    die "Haven't determined the WebHare builddir - your checkout looks too different from what I'm used to"
  fi
  mkdir -p "$WEBHARE_BUILDDIR"

  if [ -z "$WHBUILD_DOWNLOADCACHE" ]; then
    WHBUILD_DOWNLOADCACHE="$WHBUILD_BUILDROOT/downloadcache"
  fi
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

getwebhareversion()
{
  [ -n "$WEBHARE_DIR" ] || die "WEBHARE_DIR not set - couldn't figure out where the WebHare tree is"
  WEBHARE_VERSION="$(grep ^version= "$WEBHARE_DIR/etc/platform.conf" | cut -d= -f2)"

  [ -n "$WEBHARE_VERSION" ] || die "Could not get version number from $WEBHARE_DIR/etc/platform.conf"
  export WEBHARE_VERSION
}

wh_getemscriptenversion()
{
  if [ -z "$WHBUILD_EMSCRIPTEN_VERSION" ]; then
    WHBUILD_EMSCRIPTEN_VERSION="$(grep ^emscripten= "$WEBHARE_DIR/etc/platform.conf" | cut -d= -f2)"
    [ -n "$WHBUILD_EMSCRIPTEN_VERSION" ] || die "Could not set WHBUILD_EMSCRIPTEN_VERSION from $WEBHARE_DIR/etc/platform.conf"
  fi
  export WHBUILD_EMSCRIPTEN_VERSION;
}


export -f die setup_builddir getwebhareversion
export WEBHARE_PLATFORM

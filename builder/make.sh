#!/bin/bash
set -eo pipefail

REQUIRENPMVERSION="7.13.0"

WEBHARE_CHECKEDOUT_TO="$(cd "${BASH_SOURCE%/*}/.."; pwd)"
source "$WEBHARE_CHECKEDOUT_TO/whtree/lib/make-functions.sh"
estimate_buildj

if [ "$WEBHARE_PLATFORM" == "linux" ]; then
  MAKE=make
  read -r _ TOTALMEM _ <<< "$(grep ^MemTotal /proc/meminfo)"
  EXPECTMEMORY=3900000 #almost 4GB but give some tolerance
  # With too little memory the buildtoolchains will randomly segfault, and defaults for Docker/podman can be smaller than that. use eg podman machine set -m 4096
  [ "$TOTALMEM" -lt "$EXPECTMEMORY" ] && die "You need at least 4GB of memory to build WebHare ($TOTALMEM < $EXPECTMEMORY)"
else
  MAKE=gmake
fi

setup_builddir
wh_getemscriptenversion

export WEBHARE_BUILDDIR
export WHBUILD_DOWNLOADCACHE
export WHBUILD_BUILDROOT

if [ -n "$WEBHARE_IN_DOCKER" ] && [ -z "$WHBUILD_ALLOW" ]; then
  # Prevent you from accidentally breaking a running WebHare installation - did you think you were running this locally?
  die "If WEBHARE_IN_DOCKER is set you must set WHBUILD_ALLOW to be able to 'wh make'"
fi

reportVersions() {
  set +e # do not fail during version reporting
  COMMIT="$(git -C "$WEBHARE_CHECKEDOUT_TO" rev-parse HEAD)"
  BRANCH="$(git -C "$WEBHARE_CHECKEDOUT_TO" rev-parse --abbrev-ref HEAD)"
  if [ -n "$BRANCH" ] && [ "$COMMIT" != "$BRANCH" ]; then
    COMMIT="$BRANCH@$COMMIT"
  fi
  MAKEVERSION="$($MAKE --version 2>/dev/null | head -n 1 | sed -e 's/^[^0-9]*//')"
  WHNODEVERSION="$(${WEBHARE_NODE_BINARY} -v 2>/dev/null)"
  OSNODEVERSION="$(node -v 2>/dev/null)"
  echo "Versions: procs=$WHBUILD_NUMPROC wh=$WEBHARE_VERSION commit=${COMMIT:unknown} make=${MAKEVERSION} npm=${NPMVERSION} arch=$(uname -m)/$(uname -o)/$(uname -r) whnode=$WHNODEVERSION systemnode=$OSNODEVERSION"
  "${EMCC:-emcc}" -v
  set -e # restore fail on error
}

# Setup the build system
getwebhareversion

[ -n "$WEBHARE_NODE_BINARY" ] || wh_getnodeconfig

if [ "$WEBHARE_PLATFORM" == "darwin" ]; then   # Set up darwin. Make sure homebrew and packages are available
  if ! which brew >/dev/null 2>&1 ; then
    echo "On macOS we rely on Homebrew (http://brew.sh) and some additional packages being installed. Please install it"
    exit 1
  fi

  if [ -z "$NOBREW" ]; then
    # Cleanup legacy pre-wh5.9 approach
    rm -rf "$WEBHARE_CHECKEDOUT_TO/addons/darwin/webhare-deps.rb" "$WEBHARE_CHECKEDOUT_TO/addons/darwin/webhare-deps.rb.ok"

    # Get versions the Brewfile needs
    POSTGRES_MAJOR="$(grep ^postgres_major= "$WEBHARE_DIR/etc/platform.conf" | cut -d= -f2)"

    export HOMEBREW_WEBHARE_NODE_MAJOR="$WEBHARE_NODE_MAJOR"
    export HOMEBREW_POSTGRES_MAJOR="$POSTGRES_MAJOR"

    # Update if needed
    if ! brew bundle --quiet --file="$WEBHARE_CHECKEDOUT_TO/addons/darwin/Brewfile" check ; then
      echo "Installing required Homebrew packages..."
      brew bundle --file="$WEBHARE_CHECKEDOUT_TO/addons/darwin/Brewfile" install
      wh_getnodeconfig # reload config, brew may have updated node
    fi
  fi

  if [ ! -x "$WEBHARE_NODE_BINARY" ]; then
    echo "'node' still not available, please install it ('brew link node' or 'brew link node@<version>'?)"
    exit 1
  fi

elif [ "$WEBHARE_PLATFORM" == "linux" ] && [ -f /etc/redhat-release ] && ! grep CentOS /etc/redhat-release ; then
  # FIXME get this list fro setup-builder.sh!
  REQUIREPACKAGES="openssl-devel pixman-devel git freetype-devel libtiff-devel giflib-devel libjpeg-turbo-devel libpng-devel libtiff-devel pixman-devel openssl-devel libicu-devel libxml2-devel valgrind-devel libmaxminddb-devel postgresql17-libs"
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

NPMVERSION="$(npm -v)"
vercomp "$NPMVERSION" "$REQUIRENPMVERSION" ||:
if [ "$?" == "2" ]; then
  echo "You have npm $(npm -v), we desire $REQUIRENPMVERSION or higher"
  echo "You may need to update nodejs or manually install npm (eg npm install -g npm)"
  exit 1
fi

if [ -z "$WEBHARE_IN_DOCKER" ]; then # Not a docker build, configure for local building
  # TODO find a nice way to share URL and versions with Docker file
  [ -n "$WHBUILD_ASSETROOT" ] || WHBUILD_ASSETROOT="https://build.webhare.dev/whbuild/"
  # Additional dependencies
  if ! /bin/bash "$WEBHARE_CHECKEDOUT_TO/addons/docker-build/setup-pdfbox.sh" "$WHBUILD_ASSETROOT" 2.0.32 ; then
    echo "setup-pdfbox failed"
  fi
  if ! /bin/bash "$WEBHARE_CHECKEDOUT_TO/addons/docker-build/setup-tika.sh" "$WHBUILD_ASSETROOT" 2.9.2; then
    echo "setup-tika failed"
  fi
  rm -rf "$WEBHARE_CHECKEDOUT_TO/whtree/modules/system/data/engines"
fi

# Is emsdk installed?
if [ -z "$WEBHARE_IN_DOCKER" ]; then
  [ -x "$WEBHARE_CHECKEDOUT_TO/vendor/emsdk/emsdk" ] || git -C "$WEBHARE_CHECKEDOUT_TO" submodule update --init --recursive
  [ -x "$WEBHARE_CHECKEDOUT_TO/vendor/emsdk/emsdk" ] || die "Submodule vendor/emsdk not present"
  # TODO skip if already activated. need to support version checks then
  # TODO can we ensure wasm-clean is invoked (ideally set a proper dep) whenever emsdk is updated?

  if [ "$WHBUILD_EMSCRIPTEN_VERSION" != "$(cat "$WEBHARE_CHECKEDOUT_TO/vendor/wh-current-emscripten-version" 2> /dev/null)" ]; then
    "$WEBHARE_CHECKEDOUT_TO/vendor/emsdk/emsdk" install "$WHBUILD_EMSCRIPTEN_VERSION"
    "$WEBHARE_CHECKEDOUT_TO/vendor/emsdk/emsdk" activate "$WHBUILD_EMSCRIPTEN_VERSION"
    echo "$WHBUILD_EMSCRIPTEN_VERSION" > "$WEBHARE_CHECKEDOUT_TO/vendor/wh-current-emscripten-version"
  fi

  if [ -z "$DEBUGMAKE" ] && [ -z "$EMSDK_QUIET" ]; then
    export EMSDK_QUIET=1
  fi
  source "$WEBHARE_CHECKEDOUT_TO/vendor/emsdk/emsdk_env.sh"
fi

# Convert version number to 5 digit style used in C++/HareScript (GetWebHareVersionNumber)
if [[ $WEBHARE_VERSION =~ ^([0-9]{1})\.([0-9]{1,2})\.([0-9]{1,2})$ ]]; then
  VERSIONMAJOR="${BASH_REMATCH[1]}"
  VERSIONMINOR="${BASH_REMATCH[2]}"
  VERSIONPATCH="${BASH_REMATCH[3]}"
  [ ${#VERSIONMINOR} = 2 ] || VERSIONMINOR="0${VERSIONMINOR}"
  [ ${#VERSIONPATCH} = 2 ] || VERSIONPATCH="0${VERSIONPATCH}"
else
  die "Could not parse version number $WEBHARE_VERSION"
fi

# Generate the actual header
PLATFORMCONFHEADER="$WEBHARE_CHECKEDOUT_TO/blex/platformconf.h"
cat << HERE >> "$PLATFORMCONFHEADER".new
/* This file is generated by make.sh (wh make) */

#ifndef blex_platformconf
#define blex_platformconf

#define BLEX_BRANDING_PRODUCT_VERSION_NUMBER    ${VERSIONMAJOR}${VERSIONMINOR}${VERSIONPATCH}

#endif
HERE

# Do not overwrite if no changes!
if ! diff -q "$PLATFORMCONFHEADER".new "$PLATFORMCONFHEADER"; then
  echo "Updating $PLATFORMCONFHEADER"
  mv "$PLATFORMCONFHEADER".new "$PLATFORMCONFHEADER"
else
  rm "$PLATFORMCONFHEADER".new
fi

export WHBUILD_CCACHE_DIR="$WHBUILD_BUILDROOT/ccache" #for ccache only
export WHBUILD_BUILDCACHE_DIR="$WHBUILD_BUILDROOT/buildcache" #for other build artifcates

mkdir -p "$WHBUILD_CCACHE_DIR" "$WHBUILD_BUILDCACHE_DIR"

cd "$WEBHARE_BUILDDIR"

# Colors are nice
export GCC_COLORS=1

export SRCDIR="$WEBHARE_CHECKEDOUT_TO"
export WEBHARE_PLATFORM

retval=0
"$MAKE" -rj"$WHBUILD_NUMPROC" -f "$WEBHARE_CHECKEDOUT_TO/builder/base_makefile" "$@" || retval=$?

if [ "$retval" != "0" ]; then
  echo ""
  echo "Make failed with errorcode $retval"
  echo ""
  reportVersions
  echo ""

  [ -z "$WEBHARE_IN_DOCKER" ] && cat "$WEBHARE_CHECKEDOUT_TO/builder/support/failhare.txt"
  exit $retval
fi

exit 0

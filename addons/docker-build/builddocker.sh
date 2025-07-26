#!/bin/bash
set -eo pipefail

if [ -z "$WEBHARE_CHECKEDOUT_TO" ]; then
  echo "We expect to be launched by 'wh buildcontainer' "
  exit 1
fi

DOCKERBUILDARGS=()
USEPODMAN=""
NOPULL=""
DEBUG=""

source "$WEBHARE_DIR/lib/wh-functions.sh"
cd "$WEBHARE_CHECKEDOUT_TO" || exit 1
if [ ! -f builder/base_makefile ]; then
  echo "$(pwd) does not appear to be a proper WebHare source tree root"
  exit 1
fi

DOCKERFILE="$(pwd)/addons/docker-build/Dockerfile"

while [[ $1 =~ ^-.* ]]; do
  if [ "$1" == "--nopull" ]; then
    NOPULL=1
  elif [ "$1" == "--debug" ]; then
    DEBUG=1
  elif [ "$1" == "--intel" ]; then
    export DOCKER_DEFAULT_PLATFORM=linux/amd64
  elif [ "$1" == "--podman" ]; then
    USEPODMAN="1"
    # without label=disable we can't run our build scripts. Adding `,relabel=shared` to RUN --mount=type=bind helps but makes us Docker incompatible
    # but still buildah lets us enter intermediate stages like old docker build did, so maintaining podman is already useful for that
    DOCKERBUILDARGS+=(--security-opt=label=disable)
    echo "WARNING: podman builds are unsafe (stale layers) until https://github.com/containers/buildah/issues/5400 is fixed"
  elif [ "$1" == "--nocache" ] || [ "$1" == "--no-cache"  ]; then
    DOCKERBUILDARGS+=(--no-cache)
  elif [ "$1" == "--dockerfile" ]; then
    shift
    DOCKERFILE="$1"
  else
    echo "Illegal option $1"
    exit 1
  fi
  shift
done

if [ -n "$USEPODMAN" ] && [[ $(type -t whhook_prepare_podman) == function ]]; then
  whhook_prepare_podman # Allow wh script hooks to prepare the build machine
fi

if [ -n "$CI_COMMIT_SHA" ]; then
  # validate CI environment
  echo "CI build detected ($CI_COMMIT_SHA)"
  echo "CI build - environment variables:"
  set | grep -E '^(CI_|TESTFW_|WEBHARE_DEBUG)' | sort

  if [ -z "$CI_REGISTRY_IMAGE" ]; then
    echo "Please enable the container registry for this project"
    exit 1
  fi
fi

wh_getnodeconfig
wh_getemscriptenversion

get_finaltag
list_finaltag

if [ "$DOCKERSUDO" == "1" ]; then
  SUDO=sudo
else
  SUDO=
fi

if [ "$#" != "0" ]; then
  echo "Invalid argument '$1'"
  echo "Syntax: builddocker.sh [ --withoutts ]"
  exit 1
fi

#############################################################################

echo ""
echo "Packaging source tree for the WebHare runner"

# Prune empty directories
find "$WEBHARE_CHECKEDOUT_TO" -type d -empty -delete

# if [ -z "$DEBUG" ]; then
  if [ -z "$NOPULL" ]; then
    DOCKERBUILDARGS+=(--pull)
  fi

  # Enable noisier progress info, otherwise we can't actually see what the long-taking steps are ding
  DOCKERBUILDARGS+=(--progress)
  DOCKERBUILDARGS+=(plain)
# fi

[ -n "$WEBHARE_NODE_MAJOR" ] || die "WEBHARE_NODE_MAJOR not set"
[ -n "$WHBUILD_ASSETROOT" ] || WHBUILD_ASSETROOT="https://build.webhare.dev/whbuild/"
[ -n "$WHBUILD_EMSCRIPTEN_VERSION" ] || die "WHBUILD_EMSCRIPTEN_VERSION not set"
DOCKERBUILDARGS+=(--build-arg)
DOCKERBUILDARGS+=("WEBHARE_NODE_MAJOR=$WEBHARE_NODE_MAJOR")
DOCKERBUILDARGS+=(--build-arg)
DOCKERBUILDARGS+=("WHBUILD_ASSETROOT=$WHBUILD_ASSETROOT")

if [ -n "$WHBUILD_NODE_URL" ]; then
  DOCKERBUILDARGS+=(--build-arg)
  DOCKERBUILDARGS+=("WHBUILD_NODE_URL=$WHBUILD_NODE_URL")
fi

if [ -z "$CI_COMMIT_SHA" ]; then
  # Not a CI build, try to get git commit and branch
  # Also note that Runkit expects a com.webhare.webhare.git-commit-ref label to be present to recognize the image as a WebHare image
  # so this is the path used by Escrow builds to actually set this information
  CI_COMMIT_SHA="$(git rev-parse HEAD 2> /dev/null)"
  CI_COMMIT_REF_NAME="$(git rev-parse --abbrev-ref HEAD 2> /dev/null)"
  if [ -n "$CI_COMMIT_SHA$CI_COMMIT_REF_NAME" ]; then
    echo "Building from git, branch '$CI_COMMIT_REF_NAME', commit '$CI_COMMIT_SHA'"
  fi
fi

# Record CI information so we can verify eg. if this image really matches the most recent build
DOCKERBUILDARGS+=(--build-arg)
DOCKERBUILDARGS+=("CI_COMMIT_SHA=$CI_COMMIT_SHA")
DOCKERBUILDARGS+=(--build-arg)
DOCKERBUILDARGS+=("CI_COMMIT_REF_NAME=$CI_COMMIT_REF_NAME")
DOCKERBUILDARGS+=(--build-arg)
DOCKERBUILDARGS+=("CI_PIPELINE_ID=$CI_PIPELINE_ID")
DOCKERBUILDARGS+=(--build-arg)
DOCKERBUILDARGS+=("WEBHARE_VERSION=$WEBHARE_VERSION")
DOCKERBUILDARGS+=(--build-arg)
DOCKERBUILDARGS+=("WHBUILD_EMSCRIPTEN_VERSION=$WHBUILD_EMSCRIPTEN_VERSION")
DOCKERBUILDARGS+=(--file)
DOCKERBUILDARGS+=("$DOCKERFILE")

# Grab the main build dirs
# (ADDME: improve separation, consider moving whlibs/whres back to buildtree, to have a clean 'build this (ap,harescript,...)' and 'run this (whtree)' dir.)

# Ensure our version info is up to date
generatebuildinfo

function RunBuilder()
{
  local retval
  if [ -z "$USEPODMAN" ]; then
    echo "$(date) docker" "$@" >&2
    $SUDO docker "$@" ; retval="$?"
    if [ "$retval" != "0" ]; then
      echo "$(date) docker returned errorcode $retval" >&2
    fi
    return $retval
  else
    echo "$(date) podman" "$@" >&2
    $SUDO podman "$@" ; retval="$?"
    if [ "$retval" != "0" ]; then
      echo "$(date) podman returned errorcode $retval" >&2
    fi
    return $retval
  fi
}

echo "Build args:" "${DOCKERBUILDARGS[@]}"

# Build webhare image
if [ -n "$DEBUG" ]; then
  export BUILDX_EXPERIMENTAL=1
  if ! RunBuilder buildx build --invoke /bin/bash "${DOCKERBUILDARGS[@]}" -t "$BUILD_IMAGE" . ; then
    echo "Build of webhare image ($BUILD_IMAGE) failed."
    exit 1
  fi
else
  if ! RunBuilder build "${DOCKERBUILDARGS[@]}" -t "$BUILD_IMAGE" . ; then
    echo "Build of webhare image ($BUILD_IMAGE) failed."
    exit 1
  fi
fi

# If requested, push to CI
if [ -n "$PUSH_BUILD_IMAGES" ]; then
  if ! RunBuilder push "$BUILD_IMAGE" ; then
    echo "Push of $BUILD_IMAGE failed"
    exit 1
  fi
fi

echo "------results---------"
echo "Built $BUILD_IMAGE"
exit 0

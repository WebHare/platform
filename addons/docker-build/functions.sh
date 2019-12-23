# Get current version this webhare, to calculate branch head extra tag (eg 4.10)
# returns version in WHVERSION
get_whversion()
{
  WHVERSION=`(awk -- '/define BLEX_BRANDING_PRODUCT_VERSION / { print $3 }' < ../../blex/branding.h) | tr -d \"`
  if [ -z "$WHVERSION" ]; then
    echo "Unable to retrieve version #"
    exit 1
  fi
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
  local BRANCHTAGS

  get_whversion
  echo "WebHare version: $WHVERSION"
  echo ""

  # are we running on CI?
  if [ -n "$CI_COMMIT_SHA" ]; then

    # CI may push images to the CI repos
    PUSH_BUILD_IMAGES=1

    # calculate main tag based on branch name
    if [ "${CI_COMMIT_REF_NAME:0:8}" == "release/" ]; then
      # Release branch
      MAINTAG="${CI_COMMIT_REF_NAME:8}"
      BRANCHTAGS="$MAINTAG"
    elif [ "${CI_COMMIT_REF_NAME:0:3}" == "rc/" ]; then
      # Release branch
      MAINTAG="${CI_COMMIT_REF_NAME:3}-rc"
      BRANCHTAGS="$MAINTAG"
    elif [ "${CI_COMMIT_REF_NAME}" == "master" ]; then
      # Master branch
      MAINTAG="master"
      BRANCHTAGS="$MAINTAG $WHVERSION"
    else
      # Other branch
      MAINTAG="$CI_COMMIT_REF_SLUG"
      BRANCHTAGS="$MAINTAG"
    fi

    # check if there is a CI registry
    if [ -z "$CI_REGISTRY_IMAGE" ]; then
      echo "The CI_REGISTRY_IMAGE variable is not set, please enable the containter registry for this project"
      exit 1
    fi

    BUILD_IMAGE="$CI_REGISTRY_IMAGE:$MAINTAG-$CI_COMMIT_SHA"

    for P in $BRANCHTAGS ; do
      BRANCH_IMAGES="$(trim $BRANCH_IMAGES $CI_REGISTRY_IMAGE:$P)"
    done

    if [ -n "$PUBLIC_REGISTRY_IMAGE" ]; then # PUBLIC_REGISTRY_IMAGE is only set for protected branches/tags
      for P in $BRANCHTAGS ; do
        PUBLIC_IMAGES="$(trim $PUBLIC_IMAGES $PUBLIC_REGISTRY_IMAGE:$P)"
      done
    fi
  else
    # local build. No pushes or deploys

    BUILD_IMAGE="webhare/webhare-extern:localbuild${WEBHARE_LOCALBUILDIMAGEPOSTFIX}"
  fi

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

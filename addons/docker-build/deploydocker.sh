#!/bin/bash

if [ -f "${BASH_SOURCE%/*}/../../whtree/lib/wh-functions.sh" ] ; then
  # Running from a whtree
  source "${BASH_SOURCE%/*}/../../whtree/lib/wh-functions.sh"
else
  echo "Unrecognized environment for deploydocker"
  exit 1
fi

cd "${BASH_SOURCE%/*}" || exit 1

CONTAINERENGINE=docker
if [ "$USEPODMAN" == "1" ]; then
  CONTAINERENGINE=podman
fi

get_finaltag
list_finaltag
FIRST_PUBLIC_IMAGE=${PUBLIC_IMAGES/%\ */}

if [ "$PUSH_BUILD_IMAGES" != "1" ]; then
  echo "Nothing to deploy"
  exit 0
fi

echo "-----------------------------------------------------------------------"

# branch images
for P in $BRANCH_IMAGES; do
  # we can't tag an image without pulling it first, even though we really don't care about the image data..
  if ! $SUDO "$CONTAINERENGINE" pull "$BUILD_IMAGE" ; then
    echo "Pulling $P failed"
    exit 1
  fi
  if ! $SUDO "$CONTAINERENGINE" tag "$BUILD_IMAGE" "$P" ; then
    echo "Tagging $P failed"
    exit 1
  fi
  if ! $SUDO "$CONTAINERENGINE" push "$P" ; then
    echo Push of $P failed
    exit 1
  fi
done

# As we're using ephemeral builders logging out isn't needed anymore
PUSHED_PUBLIC_IMAGES=
if [ -n "$PUBLIC_IMAGES" ] && [ -n "$DOCKERHUB_REGISTRY_PASSWORD" ]; then
  # dockerhub requires a separate login. ghcr.io is taken care of by the github runner
  if ! echo "$DOCKERHUB_REGISTRY_PASSWORD" | "$CONTAINERENGINE" login -u "$DOCKERHUB_REGISTRY_USER" --password-stdin docker.io ; then
    echo "Failed to log in to the registry"
    exit 1
  fi

  for P in $PUBLIC_IMAGES ; do
    echo Tagging BUILD_IMAGE as public $P

    if ! "$CONTAINERENGINE" tag "$BUILD_IMAGE" "$P" ; then
      echo Tag for external registry failed
      exit 1
    fi
    if ! "$CONTAINERENGINE" push "$P" ; then
      echo Push to external registry failed
      exit 1
    fi
    PUSHED_PUBLIC_IMAGES="$(trim $PUSHED_PUBLIC_IMAGES $P)"
  done
fi

# Report what we pushed to the GitHub workflow (eg. to comment on the PR)
if [ -n "$GITHUB_OUTPUT" ]; then
  {
    echo "build_image=$BUILD_IMAGE"
    echo "branch_images=$BRANCH_IMAGES"
    echo "public_images=$PUSHED_PUBLIC_IMAGES"
  } >> "$GITHUB_OUTPUT"
fi

echo "-----------------------------------------------------------------------"
echo ""
echo "Done. For fast/emergency installations:"
echo ""
FIRST_BRANCH_IMAGE=${BRANCH_IMAGES/%\ */}
USEIMAGE=${FIRST_PUBLIC_IMAGE:-$FIRST_BRANCH_IMAGE}
echo "  servermgmt:    SV install -s ${USEIMAGE} <server>"
echo "  module test:   wh testcontainer -w ${USEIMAGE} -m <module>"
echo "  shell managed: wh-upgrade.sh ${USEIMAGE}"
exit 0

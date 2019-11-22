#!/bin/bash

cd `dirname $0`

source ./functions.sh
get_finaltag

if [ "$PUSH_BUILD_IMAGES" != "1" ]; then
  echo "Nothing to deploy"
  exit 0
fi

echo "-----------------------------------------------------------------------"

# branch images
for P in $BRANCH_IMAGES; do
  if ! $SUDO docker tag $BUILD_IMAGE $P ; then
    echo "Tagging $P failed"
    exit 1
  fi
  if ! $SUDO docker push "$P" ; then
    echo Push of $P failed
    exit 1
  fi
done

if [ -n "$PUBLIC_IMAGES" ]; then
  echo "-----------------------------------------------------------------------"
  echo "Tagging and pushing external images"
  if ! echo $DOCKERHUB_REGISTRY_PASSWORD | docker login -u $DOCKERHUB_REGISTRY_USER --password-stdin ; then
    echo "Failed to log in to the registry"
    exit 1
  fi

  for P in $PUBLIC_IMAGES ; do
    echo Tagging BUILD_IMAGE as public $P

    # First check version of current public image
    TOKEN=`curl -s 'https://auth.docker.io/token?service=registry.docker.io&scope=repository:webhare/webhare-core:pull' |jq -r .token`
    REPO=`cut $P -d: -f1`
    VERSION=`cut $P -d: -f2`
    MANIFESTURL="https://registry.hub.docker.com/v2/$REPO/manifests/$VERSION"
    CURRENTPIPELINE=`curl -H "Authorization: Bearer $TOKEN" "$MANIFESTURL" | jq -r .history[0].v1Compatibility|jq -r '.config.Labels."com.webhare.webhare.pipelineid"'`

    # For debugging print the enitre manifest
    echo $MANIFESTURL
    curl -i $MANIFESTURL
    curl $MANIFESTURL | jq

    echo "Current pipeline: $CURRENTPIPELINE"

    if ! docker tag "$BUILD_IMAGE" "$P" ; then
      echo Tag for external registry failed
      exit 1
    fi
    if ! docker push "$P" ; then
      echo Push to external registry failed
      exit 1
    fi
  done
fi

echo "-----------------------------------------------------------------------"
echo ""
echo "Done. For fast/emergency installations:"
echo ""
FIRST_BRANCH_IMAGE=${BRANCH_IMAGES/%\ */}
FIRST_PUBLIC_IMAGE=${PUBLIC_IMAGES/%\ */}
USEIMAGE=${FIRST_PUBLIC_IMAGE:-$FIRST_BRANCH_IMAGE}
echo "  servermgmt:    SV install -s ${USEIMAGE} <server>"
echo "  module test:   wh testdocker -w ${USEIMAGE} -m <module>"
echo "  shell managed: wh-upgrade.sh ${USEIMAGE}"
exit 0

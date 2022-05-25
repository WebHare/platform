#!/bin/bash

source "${WEBHARE_DIR}/lib/wh-functions.sh"

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

testDockerTagCalculation()
{
  __SKIP_getbaseversioninfo=1

  CI_REGISTRY_IMAGE=gitlab-registry.webhare.com/webhare-opensource/platform
  DOCKERHUB_REGISTRY_USER=exampleuser
  DOCKERHUB_REGISTRY_PASSWORD=topsecret
  PUBLIC_REGISTRY_IMAGE=webhare/platform
  FALLBACK_REGISTRY_IMAGE=registry.gitlab.com/webhare/platform
  CI_COMMIT_SHA=test
  CI_COMMIT_TAG=
  CI_COMMIT_REF_SLUG=master
  MAINTAG=

  get_finaltag
  testEq "$CI_REGISTRY_IMAGE:master" "$BRANCH_IMAGES"
  testEq "webhare/platform:master registry.gitlab.com/webhare/platform:master" "$PUBLIC_IMAGES"

  WEBHARE_VERSION=4.35.0
  CI_COMMIT_REF_NAME=release/4.35
  CI_COMMIT_REF_SLUG=release-4-35

  get_finaltag
  testEq "$CI_REGISTRY_IMAGE:release-4-35" "$BRANCH_IMAGES"
  testEq "webhare/platform:release-4-35 registry.gitlab.com/webhare/platform:release-4-35" "$PUBLIC_IMAGES"

  WEBHARE_VERSION=4.35.0
  CI_COMMIT_TAG=4.35.0
  CI_COMMIT_REF_NAME=4.35.0
  CI_COMMIT_REF_SLUG=4-35-0

  get_finaltag
  testEq "$CI_REGISTRY_IMAGE:4.35.0" "$BRANCH_IMAGES"
  testEq "webhare/platform:4.35.0 registry.gitlab.com/webhare/platform:4.35.0" "$PUBLIC_IMAGES"
}

testDockerTagCalculation

echo tests succeeded!

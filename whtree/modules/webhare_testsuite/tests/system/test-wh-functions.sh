#!/bin/bash
# wh runtest system.test-wh-functions
source "${WEBHARE_DIR}/lib/wh-functions.sh"

function testToFsPath() {
  testEq "$WEBHARE_DIR/modules/system/lib" "$(wh tofspath mod::system/lib)"
  testEq "$WEBHARE_DIR/modules/system/" "$(wh tofspath mod::system/)"
  testEq "$WEBHARE_DIR/modules/system/" "$(wh tofspath mod::system)"
  testEq "$WEBHARE_DIR/modules/system/ a b" "$(wh tofspath "mod::system/ a b")"
  testEq "${WEBHARE_DATAROOT}storage/system/" "$(wh tofspath "storage::system")"
  testEq "${WEBHARE_DATAROOT}storage/system/" "$(wh tofspath "storage::system/")"
  testEq "${WEBHARE_DATAROOT}storage/system/test/1" "$(wh tofspath "storage::system/test/1")"
  testEq "${WEBHARE_DATAROOT}storage/system/ a b" "$(wh tofspath "storage::system/ a b")"
  testEq "${WEBHARE_DATAROOT}storage/system/ a b" "$(wh tofspath "storage::system/ a b")"
  testEq "${WEBHARE_DATAROOT}storage/system/test/1 a b" "$(wh tofspath "storage::system/test/1 a b")"
}

expectWasmEngine()
{
  local STATUS=false

  echo -n "is_wasmengine(\"$2\"): "
  is_wasmengine "$2" && STATUS=true

  if [ "$STATUS" != "$1" ]; then
    echo "${STATUS} (FAIL, expected $1)"
    [ "$3" != "" ] && echo "$3"
    exit 1
  fi
  echo "${STATUS} (OK)"
}
testIsWasmEngine()
{
  expectWasmEngine true  "<?wh (*WASMENGINE*)"
  expectWasmEngine false "<?wh *WASMENGINE*)"
}

testContainerTagCalculation()
{
  CI_REGISTRY_IMAGE=gitlab-registry.webhare.com/webhare-opensource/platform
  DOCKERHUB_REGISTRY_USER=exampleuser
  DOCKERHUB_REGISTRY_PASSWORD=topsecret
  PUBLIC_REGISTRY_IMAGE=webhare/platform
  FALLBACK_REGISTRY_IMAGE=registry.gitlab.com/webhare/platform
  CI_COMMIT_SHA=test
  CI_COMMIT_TAG=

  getwebhareversion() # mock version getter
  {
    export WEBHARE_VERSION=5.6.7
  }

  CI_COMMIT_REF_NAME=master
  CI_COMMIT_REF_SLUG=master

  # building 'master' should also tag release branches so users can 'target' those for their dockers
  echo ---- CI_COMMIT_REF_NAME=$CI_COMMIT_REF_NAME CI_COMMIT_REF_SLUG=$CI_COMMIT_REF_SLUG
  get_finaltag
  list_finaltag
  testEq "$CI_REGISTRY_IMAGE:master" "$BRANCH_IMAGES"
  testEq "webhare/platform:master registry.gitlab.com/webhare/platform:master webhare/platform:release-5-6 registry.gitlab.com/webhare/platform:release-5-6 webhare/platform:5.6.7 registry.gitlab.com/webhare/platform:5.6.7" "$PUBLIC_IMAGES"
  testEq "5.6.7" "$WEBHARE_VERSION"

  getwebhareversion() # mock version getter
  {
    export WEBHARE_VERSION=4.35.0
  }

  CI_COMMIT_REF_NAME=release/4.35
  CI_COMMIT_REF_SLUG=release-4-35

  echo ---- CI_COMMIT_REF_NAME=$CI_COMMIT_REF_NAME CI_COMMIT_REF_SLUG=$CI_COMMIT_REF_SLUG
  get_finaltag
  list_finaltag
  testEq "$CI_REGISTRY_IMAGE:release-4-35" "$BRANCH_IMAGES"
  testEq "webhare/platform:release-4-35 registry.gitlab.com/webhare/platform:release-4-35 webhare/platform:4.35.0 registry.gitlab.com/webhare/platform:4.35.0" "$PUBLIC_IMAGES"
  testEq "4.35.0" "$WEBHARE_VERSION"

  CI_COMMIT_REF_NAME=custom/customer
  CI_COMMIT_REF_SLUG=custom-customer

  echo ---- CI_COMMIT_REF_NAME=$CI_COMMIT_REF_NAME CI_COMMIT_REF_SLUG=$CI_COMMIT_REF_SLUG
  get_finaltag
  list_finaltag
  testEq "$CI_REGISTRY_IMAGE:custom-customer" "$BRANCH_IMAGES"
  testEq "webhare/platform:custom-customer registry.gitlab.com/webhare/platform:custom-customer" "$PUBLIC_IMAGES"
  testEq "4.35.0" "$WEBHARE_VERSION"
}

testToFsPath
testIsWasmEngine
testContainerTagCalculation

echo tests succeeded!

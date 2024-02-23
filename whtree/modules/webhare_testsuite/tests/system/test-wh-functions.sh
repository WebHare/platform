#!/bin/bash
# wh runtest system.test-wh-functions
source "${WEBHARE_DIR}/lib/wh-functions.sh"

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

testVersionCheck()
{
  local TEXT STATUS

  echo -n "VersionCheck($2,$3): "
  TEXT="$(verify_webhare_version $2 $3)"
  STATUS="$?"
  if [ "$STATUS" != "$1" ]; then
    echo "${TEXT:-accepted} (FAIL)"
    echo "$4"
    exit 1
  fi
  echo "${TEXT:-accepted} (OK)"
}

testAllowedUpgrade()
{
  testVersionCheck 0 "$@"
}
testRejectedUpgrade()
{
  testVersionCheck 1 "$@"
}

testVersionChecks()
{
  #testAllow/Reject   PREVIOUS   NEW
  testAllowedUpgrade  5.0.2-dev  5.0.2-dev  "Comparing identical versions should be fine"
  testRejectedUpgrade 5.0.2      5.0.1      "Downgrade from 5.0.2 to 5.0.1 should not have been accepted"
  testAllowedUpgrade  5.0.2-dev  5.0.2      "Accept going from -dev to real version"
  testAllowedUpgrade  5.0.1-dev  5.0.2      "Accept going from previous -dev to a real version"
  testAllowedUpgrade  4.35.0     5.0.0-dev  "Accept major update"
  testRejectedUpgrade 5.0.3-dev  5.0.2      "Should not allow you to downgrade from -dev back to the previous prod version"
  testRejectedUpgrade 5.0.3      5.0.3-dev  "Should not allow you to downgrade back to -dev"

  testAllowedUpgrade  4.34.0     4.35.0     "Accept minor upgrade (if this check had already existed in 4.35...)"
  testRejectedUpgrade 4.34.0     5.0.0      "Should not allow you to upgrade from 4.34 straight to 5.0"
  testRejectedUpgrade 4.34.0     5.0.0-dev  "Should not allow you to upgrade from 4.34 straight to 5.0"
  testRejectedUpgrade 4.34.99    5.0.0-dev  "Should not allow you to upgrade from 4.34 straight to 5.0"
  testRejectedUpgrade 4.35.0-dev 5.0.0-dev  "Should not allow you to upgrade from 4.35 dangerous prereleases straight to 5.0"

  testRejectedUpgrade 5.1.0-dev  5.1.0-custom-5.1  "Same base version, but dev > custom, so unacceptable"
  testAllowedUpgrade  5.1.0-dev  5.1.1-custom-5.1  "A 'sideways' upgrade to newer is acceptable"
  testRejectedUpgrade 5.1.1-dev  5.1.0-custom-5.1  "A 'sideways' upgrade to older is unacceptable"

  testRejectedUpgrade 5.1.0-dev  5.1.0-5-1-certbotupdates  "Don't get confused by the many numbers added by a custom/5-1-certbotupdates branch #1"
  testAllowedUpgrade  5.1.0-5-1-certbotupdates  5.1.0-dev  "Don't get confused by the many numbers added by a custom/5-1-certbotupdates branch #2"
}

testDockerTagCalculation()
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

testIsWasmEngine
testVersionChecks
testDockerTagCalculation

echo tests succeeded!

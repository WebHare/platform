#!/bin/bash

# short: Run the TWOHARE testset
# To invoke this test:  wh webhare_testsuite:twoharetests

die()
{
  echo "$1"
  exit 1
}
die_help()
{
  cat << HERE
Error: $1

You can run this script manually by providing port numbers and execution commands
for two WebHares. I personally use:

export TH_EXEC1="wh"
export TH_EXEC2="wh-moe2"

where wh-moe2 is a second WebHare run with freshdbconsole (runkit @moe2 freshdbconsole)

You can then run this script with:
wh webhare_testsuite:twoharetests

HERE
  exit 1
}

OUTPUTDIR="/tmp/output"

if [ -n "$1" ]; then
  die_help "invalid syntax"
fi

if [ -n "$TESTENV_CONTAINER1" ]; then
  OUTPUTDIR="/output"
  TH_EXEC1="podman exec $TESTENV_CONTAINER1 wh"
  TH_IP1=$(podman inspect --format='{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$TESTENV_CONTAINER1")
  if [ -z "$TH_IP1" ]; then
    podman inspect "$TESTENV_CONTAINER1"
    die "Failed to obtain IP address for container 1"
  fi
  TH_WEBINTERFACE1="http://$TH_IP1"
fi
if [ -n "$TESTENV_CONTAINER2" ]; then
  TH_EXEC2="podman exec $TESTENV_CONTAINER2 wh"
  TH_IP2=$(podman inspect --format='{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$TESTENV_CONTAINER2")
  if [ -z "$TH_IP2" ]; then
    podman inspect "$TESTENV_CONTAINER2"
    die "Failed to obtain IP address for container 2"
  fi
  TH_WEBINTERFACE2="http://$TH_IP2"
fi

# xargs trims the whitespace here
if [ -n "$TH_EXEC1" ] && [ -z "$TH_WEBINTERFACE1" ]; then
  TH_WEBINTERFACE1="$($TH_EXEC1 get backendurl)"
fi
if [ -n "$TH_EXEC2" ] && [ -z "$TH_WEBINTERFACE2" ]; then
  TH_WEBINTERFACE2="$($TH_EXEC2 get backendurl)"
fi

if [ -z "$TH_WEBINTERFACE1" ]; then
  die_help "missing config for container 1"
fi
if [ -z "$TH_WEBINTERFACE2" ]; then
  die_help "missing config for container 2"
fi

$TH_EXEC1 isrunning || die "Container 1 ($TH_EXEC1) is not running"
$TH_EXEC2 isrunning || die "Container 2 ($TH_EXEC2) is not running - start it with a freshdbconsole"

# Make sure the testserver knows it's supposed to be listening here (testfw configures in virtualhosting and assumes you want 127.0.0.1, and TH_WEBINTERFACE2 will often be 172.0.2.2)
$TH_EXEC2 webserver addbackend --virtual --primary  "$TH_WEBINTERFACE2"

echo "Using Web interface for container 1 at $TH_WEBINTERFACE1"
echo "Using Web interface for container 2 at $TH_WEBINTERFACE2"

# debugging may require setting WEBHARE_DEBUG=test-keepbrowser
if ! $TH_EXEC1 registry set webhare_testsuite.tests.secondhareinterface "$TH_WEBINTERFACE2" ||
   ! $TH_EXEC2 run mod::webhare_testsuite/tests/system/twohare/prepare-server2.ts ||
   ! $TH_EXEC1 runtest -d -e -o --outputdir "$OUTPUTDIR" system.twohare.test_peerserver;then
  die "tests failed"
fi

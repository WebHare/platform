#!/bin/bash

# command: wh webhare_testsuite:twoharetests
# short: Run the TWOHARE testset

die()
{
  echo $1
  exit 1
}
die_help()
{
  cat << HERE
Error: $1

You can run this script manually by providing port numbers and execution commands
for two WebHares. I personally use:

export TESTFW_TWOHARES=1
export TH_EXEC1="wh"
export TH_EXEC2="wh-moe2"
export TH_WEBINTERFACE1=https://webhare.moe.sf.webhare.nl/
export TH_WEBINTERFACE2=http://127.0.0.1:8081/

where wh-moe2 is a second WebHare run with freshdbconsole

You can then run this script with:
wh webhare_testsuite:twoharetests

HERE
  exit 1
}

if [ -n "$TESTENV_CONTAINER1" ]; then
  TH_EXEC1="docker exec $TESTENV_CONTAINER1 wh"
  TH_IP1=$(docker inspect --format='{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' $TESTENV_CONTAINER1)
  TH_WEBINTERFACE1="http://$TH_IP1:8000"
fi
if [ -n "$TESTENV_CONTAINER2" ]; then
  TH_EXEC2="docker exec $TESTENV_CONTAINER2 wh"
  TH_IP2=$(docker inspect --format='{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' $TESTENV_CONTAINER2)
  TH_WEBINTERFACE2="http://$TH_IP2:8000"
fi

[ -n "$TH_EXEC1" -a -n "$TH_WEBINTERFACE1" ] || die_help "missing config for container 1"
[ -n "$TH_EXEC2" -a -n "$TH_WEBINTERFACE2" ] || die_help "missing config for container 2"

# Make sure the testserver knows it's supposed to be listening here (testfw configures in virtualhosting and assumes you want 127.0.0.1:8000, and TH_WEBINTERFACE2 will often be 172.0.2.2:8000)
$TH_EXEC2 webserver addbackend $TH_WEBINTERFACE2

#$TH_EXEC1 run mod::webhare_testsuite/tests/system/twohare/prepare1.whscr
$TH_EXEC1 registry set webhare_testsuite.tests.secondhareinterface $TH_WEBINTERFACE2 &&
  $TH_EXEC2 run mod::webhare_testsuite/tests/system/twohare/prepare-server2.whscr &&
  $TH_EXEC1 runtest --outputdir /output system.twohare.test_peerserver ||
  die "tests failed"

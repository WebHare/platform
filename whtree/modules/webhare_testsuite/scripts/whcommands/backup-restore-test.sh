#!/bin/bash

# command: wh webhare_testsuite:backup-restore-test
# short: Run the backup-restore-test

die()
{
  echo $1
  exit 1
}
die_help()
{
  cat << HERE
Error: $1

You can run this script manually by providing it with a WebHare container, eg:

MYIMAGE=webhare/platform:master
docker pull $MYIMAGE
rm -rf /tmp/backup-restore-test
export TESTENV_CONTAINER1="$(docker run -d -v /tmp/backup-restore-test:/opt/whdata --name wh-backup-restore-test $MYIMAGE)"
wh webhare_testsuite:backup-restore-test
HERE
  exit 1
}

set -x
set -e #Demand that all these commands succeed!

[ -z "$TESTENV_CONTAINER1" ] && die "Where is my TESTENV_CONTAINER1 ?"

docker exec "$TESTENV_CONTAINER1" wh waitfor poststartdone || die "WebHare isn't starting"
docker exec "$TESTENV_CONTAINER1" wh users adduser "backup-reference-user@example.net" || die "Cannot create user backup-reference-user@example.net"
docker exec "$TESTENV_CONTAINER1" wh preparebackup
docker exec "$TESTENV_CONTAINER1" sv stop webhare

# Remove all whdata folders except for the prepared backup
docker exec "$TESTENV_CONTAINER1" find /opt/whdata -mindepth 1 -maxdepth 1 -not -name preparedbackup -exec rm -rf {} \;

docker exec "$TESTENV_CONTAINER1" sv start webhare
docker exec "$TESTENV_CONTAINER1" wh waitfor poststartdone || die "Emptied WebHare isn't starting"
docker exec "$TESTENV_CONTAINER1" wh users getuser "backup-reference-user@example.net" && die "User backup-reference-user@example.net shouldn't exist clearing WebHare"
docker exec "$TESTENV_CONTAINER1" sv stop webhare

# Again, remove all whdata folders except for the prepared backup
docker exec "$TESTENV_CONTAINER1" find /opt/whdata -mindepth 1 -maxdepth 1 -not -name preparedbackup -exec rm -rf {} \;

# Tell WebHare to restore its data
docker exec "$TESTENV_CONTAINER1" wh restore /opt/whdata/preparedbackup

# Restart it
docker exec "$TESTENV_CONTAINER1" sv start webhare
docker exec "$TESTENV_CONTAINER1" wh waitfor poststartdone || die "Restored WebHare isn't starting"
docker exec "$TESTENV_CONTAINER1" wh users getuser "backup-reference-user@example.net" || die "User backup-reference-user@example.net SHOULD exist after restore"

# SUCCESS!

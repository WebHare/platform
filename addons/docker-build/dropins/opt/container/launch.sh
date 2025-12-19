#!/bin/bash

# A hook to allow CI to pause our actual startup
until [ ! -f /pause-webhare-startup ]; do
  sleep .2 ;
done

eval `/opt/wh/whtree/bin/wh setupmyshell`

# Setup JAVA_HOME
if [ "$(uname -m)" == "aarch64" ]; then
  export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-arm64
else
  export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
fi

export PATH=$PATH:$JAVA_HOME/bin

# Ensure /tmp/ exists with sticky permissions. our podman builds showed up without /tmp. ?
mkdir -p /tmp 2>/dev/null
chmod 1777 /tmp 2>/dev/null

# Ensure root has /opt/whdata/root/
mkdir -p /opt/whdata/root
chown root /opt/whdata/root

# If no $HOME/.vimrc exists, create it to make vi behave more sane. This is the way we like it
if [ ! -f /opt/whdata/root/.vimrc ]; then
  echo '" Necessary line' > /opt/whdata/root/.vimrc
  echo 'set nocompatible' >> /opt/whdata/root/.vimrc
fi

# If the database is referring to /opt/webhare/output, which is a symlink now to /opt/whdata/output, but /opt/whdata/output is missing, WebHare can't fix it
# probably no longer relevant since we're now mostly converting database outputfolders to be fully relative to /opt/whdata/output/
mkdir -p /opt/whdata/output /opt/whdata/installedmodules
# Create tmp storage dir, webhare-docker-config.xml refers to this
mkdir -p /opt/whdata/tmp

# Ensure webhare owns /opt/whdata and that it's masked from 'other' users
chgrp whdata /opt/whdata
chmod o-rwx /opt/whdata

# Mount needed data for restores
if [ -f /opt/whdata/backupmountconfig ]; then
  source /opt/whdata/backupmountconfig
fi

if [ -f "/opt/whdata/restore-in-progress" ]; then
  echo "Previous restore did not complete properly"
  exit 1
fi

if [ -n "$WH_RESTORE_FILESSOURCE" ]; then
  mkdir -p /opt/backups/files
  sshfs "$WH_RESTORE_FILESSOURCE" /opt/backups/files -o StrictHostKeyChecking=no,ro,auto_cache,reconnect"$WH_RESTORE_SSHFSOPTS"
fi

if [ -n "$WH_RESTORE_DATABASESOURCE" ]; then
  if [ -z "$WH_RESTORE_DATABASESOURCEMOUNT" ]; then
    WH_RESTORE_DATABASESOURCEMOUNT=/opt/backups/database
  fi
  mkdir -p "$WH_RESTORE_DATABASESOURCEMOUNT"
  if ! sshfs "$WH_RESTORE_DATABASESOURCE" "$WH_RESTORE_DATABASESOURCEMOUNT" -o StrictHostKeyChecking=no,ro,auto_cache,reconnect"$WH_RESTORE_SSHFSOPTS"; then
    echo "Failed to mount database backup"
    exit 1
  fi
fi

# Set the timezone
ln -sf /usr/share/zoneinfo/Europe/Amsterdam /etc/localtime

# Delete old docker config to avoid confusion
[ -f /opt/whdata/webhare-config.xml ] && rm /opt/whdata/webhare-config.xml

# Control core sizes with ulimit... so that we can still raise them later!
ulimit -Sc 0

# Run any startup scripts (CI tests may inject these)
for f in /opt/wh/whtree/etc/startup.d/*; do
  if [ -x "$f" ]; then
    echo "Running startup script $f"
    "$f"
  fi
done

# 1) apparently bash can reap orphans. so we can keep ourselves running
# 2) our runsv change still wasn't good enough, it sends the terminates but doesn't wait for the children to die.
#    but the container will SIGKILL everything once PID 1 goes away

# If runsvdir receives a HUP signal, it sends a TERM signal to each runsv(8) process it is monitoring and then exits with 111.
/usr/bin/runsvdir /etc/service &
RUNSVDIR_PID=$!

function shutdown()
{
  kill -HUP $RUNSVDIR_PID
  while /opt/wh/whtree/bin/wh isrunning; do
    sleep .1
  done
  exit 0
}

trap shutdown TERM INT

wait $RUNSVDIR_PID

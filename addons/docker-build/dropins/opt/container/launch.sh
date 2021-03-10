#!/bin/bash
eval `/opt/wh/whtree/bin/wh setupmyshell`

# Ensure root has /opt/whdata/home/root/
mkdir -p /opt/whdata/home/root
chown root /opt/whdata/home/root

# If no $HOME/.vimrc exists, create it to make vi behave more sane. This is the way we like it
if [ ! -f /opt/whdata/home/root/.vimrc ]; then
  echo '" Necessary line' > /opt/whdata/home/root/.vimrc
  echo 'set nocompatible' >> /opt/whdata/home/root/.vimrc
fi

# If the database is referring to /opt/webhare/output, which is a symlink now to /opt/whdata/output, but /opt/whdata/output is missing, WebHare can't fix it
# probably no longer relevant since we're now mostly converting database outputfolders to be fully relative to /opt/whdata/output/
mkdir -p /opt/whdata/output /opt/whdata/installedmodules
# Create tmp storage dir, webhare-docker-config.xml refers to this
mkdir -p /opt/whdata/tmp

# Test for ephemeral storage
if [ -z "$WEBHARE_ALLOWEPHEMERAL" ]; then
  WHDATAFS="`stat -f -c %T /opt/whdata/`"
  if [ "$WHDATAFS" == "overlayfs" ]; then
    echo "Cowardly refusing to run on ephemeral storage. Set WEBHARE_ALLOWEPHEMERAL=1 if you really want this"
    exit 1
  fi
fi

# Ensure webhare owns /opt/whdata and that it's masked from 'other' users
chgrp whdata /opt/whdata
chmod o-rwx /opt/whdata

if [ -n "$WHBUILD_ISTESTSUITEBUILD" ]; then
  # If this is a test build, we have an existing database. we must upcopy it to prevent sync/flush errors
  touch /opt/whdata/dbase/*
fi

# Extracting embedded webhare_testsuite - the currently tested module still relies on it
if [ -n "$WH_EXTRACTTESTSUITE" ]; then
  echo `date` Extracting module webhare_testsuite
  if ! tar -C /opt/whdata/installedmodules/ -xf /opt/wh/whtree/webhare_testsuite.tar.gz ; then
    echo "Failed to extract testsuite!"
    exit 1
  fi

  echo `date` Start fixmodules for webhare_testsuite
  wh fixmodules webhare_testsuite #download deps for basetest

  # Extract compiled webhare_testsuite assetpack
  if [ -f /build/webare_testsuite_assetpacks.tar.gz ]; then
    echo `date` "Installing embedded assetpack from /build/webare_testsuite_assetpacks.tar.gz"
    mkdir -p /opt/whdata/publisher.ap/
    tar -C /opt/whdata/publisher.ap/ -xf /build/webare_testsuite_assetpacks.tar.gz
    ls -l /opt/whdata/publisher.ap/
  fi

  echo `date` "Finished initial webhare_testsuite preparation"
fi

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

# If runsvdir receives a HUP signal, it sends a TERM signal to each runsv(8) process it is monitoring and then exits with 111.
# docker stop sends us a TERM. so we need to make sure a TERM on us becomes a HUP.
exec /usr/bin/dumb-init --rewrite 15:1 -- /usr/bin/runsvdir /etc/service

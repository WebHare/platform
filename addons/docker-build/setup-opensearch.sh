#!/bin/bash
# We can't mark this script as executable as it shouldn't be run on a build host. But we still need the she-bang for shellcheck

# DL instructions from https://opensearch.org/docs/latest/opensearch/install/tar/
# DL packages from here - https://opensearch.org/downloads.html
# We locally mirror the packages here: https://cms.webhare.dev/?app=publisher(/webhare.dev/build.webhare.dev/whbuild/)

# To locally test and debug changes to the OpenSearch build and initialization in docker:
# wh buildcontainer && wh testcontainer --sh --tag=-external -w local consilio

ASSETROOT="$1"
GETVERSION="$2"

export JAVA_HOME=/usr/lib/jvm/java-21-openjdk
if [ "$(uname -m)" == "x86_64" ]; then
  GETFILE=opensearch-${GETVERSION}-linux-x64.tar.gz
  FALLBACKURL=https://artifacts.opensearch.org/releases/bundle/opensearch/${GETVERSION}/${GETFILE}
elif [ "$(uname -m)" == "aarch64" ]; then
  GETFILE=opensearch-${GETVERSION}-linux-arm64.tar.gz
  FALLBACKURL=https://artifacts.opensearch.org/releases/bundle/opensearch/${GETVERSION}/${GETFILE}
else
  echo "This script does not support machine: '$(uname -m)'"
  exit 1
fi

DLPATH=/tmp/downloads/$GETFILE

if ! curl -fsS -o "$DLPATH" -z "$DLPATH" "${ASSETROOT}${GETFILE}" ; then
  echo "Primary download failed, attempting fallback location"
  if ! curl -fsS -o "$DLPATH" -z "$DLPATH" "${FALLBACKURL}" ; then
    rm -f "$DLPATH"
    echo "Download failed"
    exit 1
  fi
fi

mkdir /opt/opensearch
tar zx -C /opt/opensearch --strip-components=1 -f $DLPATH
chown -R opensearch /opt/opensearch

# Remove the bundled JDK and plugins
rm -rf /opt/opensearch/jdk /opt/opensearch/plugins/* /opt/opensearch/performance-analyzer-rca

runuser --user opensearch --group opensearch -- /opt/opensearch/bin/opensearch --version
RETVAL="$?"
if [ "$RETVAL" != "0" ]; then
  echo "Install failed? Errorcode $RETVAL from 'opensearch --version'"
  exit 1
fi

# Remove alll the shipped plugins
#for PLUGIN in $(runuser --user opensearch --group opensearch -- /opt/opensearch/bin/opensearch-plugin list); do
#  runuser --user opensearch --group opensearch -- /opt/opensearch/bin/opensearch-plugin remove "$PLUGIN"
#done

runuser --user opensearch --group opensearch -- /opt/opensearch/bin/opensearch-plugin install analysis-icu
RETVAL="$?"
if [ "$RETVAL" != "0" ]; then
  echo "Install failed? Errorcode $RETVAL from analysis-icu installation"
  exit 1
fi

exit 0

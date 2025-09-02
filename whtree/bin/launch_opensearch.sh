#!/bin/bash
set -e

# To locally test and debug changes to the OpenSearch build and initialization in podman:
# wh buildcontainer && wh testcontainer --sh --tag=-external -w local consilio

if [ -z "$WEBHARE_BASEPORT" ]; then
  echo "WEBHARE_BASEPORT name not set"
  exit 1
fi
if [ -z "$WEBHARE_DATAROOT" ]; then
  echo "WEBHARE_DATAROOT name not set"
  exit 1
fi
if [ -z "$WEBHARE_DIR" ]; then
  echo "WEBHARE_DIR name not set"
  exit 1
fi

if [ "$(uname -m)" == "aarch64" ]; then
  export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-arm64
else
  export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
fi

echo "Max open files: $(ulimit -n)"

OPENSEARCHPORT=$(( $WEBHARE_BASEPORT + 6 ))
OPENSEARCHROOT="$WEBHARE_DATAROOT/opensearch"

# Rename old data folder
if [ -d "$WEBHARE_DATAROOT/elasticsearch" ] && [ ! -d "$OPENSEARCHROOT" ]; then
  mv "$WEBHARE_DATAROOT/elasticsearch" "$OPENSEARCHROOT"
fi

ADDOPTIONS="--quiet"

if [ -z "$WEBHARE_OPENSEARCH_BINDHOST" ]; then
  WEBHARE_OPENSEARCH_BINDHOST=127.0.0.1
fi

# "Elasticsearch does not remove its temporary directory. You should remove leftover temporary directories while Elasticsearch is not running. It is best to do this automatically, for instance on each reboot."
rm -rf -- "$OPENSEARCHROOT/tmp"
mkdir -p -- "$OPENSEARCHROOT/logs" "$OPENSEARCHROOT/data" "$OPENSEARCHROOT/repo" "$OPENSEARCHROOT/tmp"
if [ -n "$WEBHARE_IN_DOCKER" ]; then
  chown opensearch:opensearch -- "$OPENSEARCHROOT/logs" "$OPENSEARCHROOT/data" "$OPENSEARCHROOT/repo" "$OPENSEARCHROOT/tmp"
  # It seems the linux version has more plugins than the brew version, and needs these options:
  #ADDOPTIONS="-Eplugins.security.disabled=true -Eplugins.security.ssl.http.enabled=false"
fi

if [ -x /opt/opensearch/bin/opensearch ]; then  #linux docker build
  OPENSEARCHBINARY=/opt/opensearch/bin/opensearch
else
  OPENSEARCHBINARY="$(which opensearch || true)"
  [ -n "$OPENSEARCHBINARY" ] || die "No opensearch binary found in PATH"
fi

INITIALMEMORY="$1"
MAXIMUMMEMORY="$2"

if [ -z "$MAXIMUMMEMORY" ]; then
  echo "No configuration parameters received"
  exit 1
fi

export OPENSEARCH_JAVA_OPTS="-Xms${INITIALMEMORY}m -Xmx${MAXIMUMMEMORY}m -XX:-AlwaysPreTouch -Xlog:gc*,gc+age=trace,safepoint:file=${OPENSEARCHROOT}/logs/gc.log:utctime,pid,tags:filecount=32,filesize=64m -Djava.io.tmpdir=${OPENSEARCHROOT}/tmp -Djava.security.egd=file:/dev/./urandom -Djava.security.properties=${WEBHARE_DIR}/etc/java.security.override"

CHPST=""
if [ -n "$WEBHARE_IN_DOCKER" ]; then
  CHPST="chpst -u opensearch:opensearch:whdata "
fi

if [ -z "$WEBHARE_IN_DOCKER" ]; then

  if [ -z "$WEBHARE_CHECKEDOUT_TO" ]; then
    echo "WEBHARE_CHECKEDOUT_TO is not set?"
    exit 1
  fi

  # Brew doesn't update /opt/homebrew/etc/opensearch after install, so just point directly to the linked keg's version of the configuration
  OPENSEARCH_PATH_CONF="$(brew --prefix)/opt/opensearch/.bottle/etc/opensearch"
  export OPENSEARCH_PATH_CONF

  setup_builddir
  # Who thought it was a good idea to write the version to stderr even if explicitly invoking --version ?
  CURRENT_OPENSEARCHVERSION="$($CHPST "$OPENSEARCHBINARY" --version 2>&1 | (grep ^Version || true) )"
  if [ -z "$CURRENT_OPENSEARCHVERSION" ]; then
    echo "*** Failed to get opensearch version from $OPENSEARCHBINARY"
    echo "If reporting this also include the actual output of opensearch --version:"
    echo ""
    $CHPST "$OPENSEARCHBINARY" --version || true
    exit 1
  fi

  # Remove from old location (remove at Date.now >= 2025-10-09)
  [ -f "$WEBHARE_CHECKEDOUT_TO/.checkoutstate/last-brew-install" ] && rm "$WEBHARE_CHECKEDOUT_TO/.checkoutstate/last-brew-install"
  [ -f "$WEBHARE_CHECKEDOUT_TO/.checkoutstate/lastopensearchversion" ] && rm "$WEBHARE_CHECKEDOUT_TO/.checkoutstate/lastopensearchversion"
  rmdir "$WEBHARE_CHECKEDOUT_TO/.checkoutstate" 2>/dev/null || true # try to cleanup the dir now

  # Store the checkfile in 'whbuild' so discarding that directory (which you should do when changing platforms) resets the brew state too
  CHECKFILE="$WEBHARE_BUILDDIR/lastopensearchversion"

  LAST_OPENSEARCHVERSION="$(cat "$CHECKFILE" 2>/dev/null || true)"
  if [ "$CURRENT_OPENSEARCHVERSION" != "$LAST_OPENSEARCHVERSION" ]; then
    # Reinstall our plugins when Opensearch is updated
    "$OPENSEARCHBINARY-plugin" remove analysis-icu 2>/dev/null || true
    "$OPENSEARCHBINARY-plugin" install analysis-icu

    echo "$CURRENT_OPENSEARCHVERSION" > "$CHECKFILE"
  fi
fi

# Add -Elogger.level=DEBUG for lots of debug info
OPTIONS=( -Epath.data="$OPENSEARCHROOT/data"
          -Epath.logs="$OPENSEARCHROOT/logs"
          -Epath.repo="$OPENSEARCHROOT/repo"
          -Ehttp.port="$OPENSEARCHPORT"
          -Ehttp.host="$WEBHARE_OPENSEARCH_BINDHOST"
          -Ediscovery.type=single-node
          )

exec $CHPST "$OPENSEARCHBINARY" "${OPTIONS[@]}" $ADDOPTIONS

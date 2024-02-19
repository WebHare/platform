#!/bin/bash
set -e

# To locally test and debug changes to the OpenSearch build and initialization in docker:
# wh builddocker && wh testdocker --sh --tag=-external -w local consilio

if [ -z "$WEBHARE_BASEPORT" ]; then
  echo "WEBHARE_BASEPORT name not set"
  exit 1
fi
if [ -z "$WEBHARE_DATAROOT" ]; then
  echo "WEBHARE_DATAROOT name not set"
  exit 1
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

mkdir -p "$OPENSEARCHROOT/logs" "$OPENSEARCHROOT/data" "$OPENSEARCHROOT/repo"
if [ -n "$WEBHARE_IN_DOCKER" ]; then
  chown opensearch:opensearch "$OPENSEARCHROOT/logs" "$OPENSEARCHROOT/data" "$OPENSEARCHROOT/repo"
  # It seems the linux version has more plugins than the brew version, and needs these options:
  #ADDOPTIONS="-Eplugins.security.disabled=true -Eplugins.security.ssl.http.enabled=false"
fi

if [ -x /usr/local/opt/opensearch/bin/opensearch ]; then  #macOS Homebrew on x86
  OPENSEARCHBINARY=/usr/local/opt/opensearch/bin/opensearch
elif [ -x /opt/opensearch/bin/opensearch ]; then  #linux docker build
  OPENSEARCHBINARY=/opt/opensearch/bin/opensearch
else
  if ! which opensearch; then
    echo "No opensearch binary in path"
    exit 1
  fi
  OPENSEARCHBINARY=opensearch #assume path lookup will find it
fi

INITIALMEMORY="$1"
MAXIMUMMEMORY="$2"

if [ -z "$MAXIMUMMEMORY" ]; then
  echo "No configuration parameters received"
  exit 1
fi

export _JAVA_OPTIONS="-Xms${INITIALMEMORY}m -Xmx${MAXIMUMMEMORY}m -XX:-AlwaysPreTouch"

CHPST=""
if [ -n "$WEBHARE_IN_DOCKER" ]; then
  CHPST="chpst -u opensearch:opensearch:whdata "
else
  _JAVA_OPTIONS="$_JAVA_OPTIONS -Djava.security.manager=allow"    #linux opensearch 1.3.2 doesn't seem to like securitymanager anymore but brew does
fi

if [ -z "$WEBHARE_IN_DOCKER" ]; then

  if [ -z "$WEBHARE_CHECKEDOUT_TO" ]; then
    echo "WEBHARE_CHECKEDOUT_TO is not set?"
    exit 1
  fi

  setup_builddir

  CURRENT_OPENSEARCHVERSION="$($CHPST "$OPENSEARCHBINARY" --version)"

  # Remove from old location (remove at Date.now >= 2024-02-13)
  [ -f "$WEBHARE_CHECKEDOUT_TO/.checkoutstate/last-brew-install" ] && rm "$WEBHARE_CHECKEDOUT_TO/.checkoutstate/last-brew-install"
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

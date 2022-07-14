#!/bin/bash

# To locally test and debug changes to the OpenSearch build and initialization in docker:
# wh builddocker && wh testdocker --nocleanup --tag=-external -w local consilio


echo "Max open files: $(ulimit -n)"

eval $("$WEBHARE_DIR/bin/webhare" printparameters)
OPENSEARCHPORT=$(( $WEBHARE_BASEPORT + 6 ))
OPENSEARCHROOT="$WEBHARE_DATAROOT/opensearch"

# Rename old data folder
if [ -d "$WEBHARE_DATAROOT/elasticsearch" ] && [ ! -d "$OPENSEARCHROOT" ]; then
  mv "$WEBHARE_DATAROOT/elasticsearch" "$OPENSEARCHROOT"
fi

ADDOPTIONS=""

if [ -z "$WEBHARE_ELASTICSEARCH_BINDHOST" ]; then
  WEBHARE_ELASTICSEARCH_BINDHOST=127.0.0.1
fi

mkdir -p "$OPENSEARCHROOT/logs" "$OPENSEARCHROOT/data" "$OPENSEARCHROOT/repo"
if [ -n "$WEBHARE_IN_DOCKER" ]; then
  chown opensearch:opensearch "$OPENSEARCHROOT/logs" "$OPENSEARCHROOT/data" "$OPENSEARCHROOT/repo"
  # It seems the linux version has more plugins than the brew version, and needs these options:
  ADDOPTIONS="-Eplugins.security.disabled=true -Eplugins.security.ssl.http.enabled=false"
fi

if [ -x  /usr/local/opt/opensearch/bin/opensearch ]; then  #macOS Homebrew on x86
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

INITIALMEMORY=$(wh registry get consilio.builtinelasticsearch.initialmemorypool)
if [ "$INITIALMEMORY" == "0" ]; then
  INITIALMEMORY=300
fi

MAXIMUMMEMORY=$(wh registry get consilio.builtinelasticsearch.maximummemorypool)
if [ "$MAXIMUMMEMORY" == "0" ]; then
  MAXIMUMMEMORY=2000
fi

#Workaround JDK 18 requiring this option for opensearch right now..
export _JAVA_OPTIONS="-Xms${INITIALMEMORY}m -Xmx${MAXIMUMMEMORY}m"

CHPST=""
if [ -n "$WEBHARE_IN_DOCKER" ]; then
  CHPST="chpst -u opensearch:opensearch:whdata "
else
  _JAVA_OPTIONS="$_JAVA_OPTIONS -Djava.security.manager=allow"    #linux opensearch 1.3.2 doesn't seem to like securitymanager anymore but brew does

  # We don't currently have a way to check if the installed plugin versions match the Opensearch version, so we'll just remove
  # and reinstall the necessary plugins on startup
  "$OPENSEARCHBINARY-plugin" remove analysis-icu
  "$OPENSEARCHBINARY-plugin" install analysis-icu
fi

exec $CHPST "$OPENSEARCHBINARY" -Epath.data="$OPENSEARCHROOT/data" \
                                -Epath.logs="$OPENSEARCHROOT/logs" \
                                -Epath.repo="$OPENSEARCHROOT/repo" \
                                -Ehttp.port=$OPENSEARCHPORT \
                                -Ehttp.host=$WEBHARE_ELASTICSEARCH_BINDHOST \
                                -Ediscovery.type=single-node \
                                $ADDOPTIONS

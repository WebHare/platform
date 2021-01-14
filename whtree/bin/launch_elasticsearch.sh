#!/bin/bash
echo "Max open files: $(ulimit -n)"

eval `$WEBHARE_DIR/bin/webhare printparameters`
ELASTICSEARCHPORT=$(( $WEBHARE_BASEPORT + 6 ))
ELASTICSEARCHROOT=$WEBHARE_DATAROOT/elasticsearch

mkdir -p $ELASTICSEARCHROOT/logs $ELASTICSEARCHROOT/data $ELASTICSEARCHROOT/repo
if [ -n "$WEBHARE_IN_DOCKER" ]; then
  chown elasticsearch:elasticsearch $ELASTICSEARCHROOT/logs $ELASTICSEARCHROOT/data $ELASTICSEARCHROOT/repo
fi

if [ -x /opt/elasticsearch/bin/elasticsearch ]; then
  export ESHOME=/opt/elasticsearch/
  ELASTICSEARCHBINARY=/opt/elasticsearch/bin/elasticsearch
elif [ -x /usr/share/elasticsearch/bin/elasticsearch ]; then
  if ! groups | grep &>/dev/null '\belasticsearch\b'; then
    echo "The current user must be member of the group 'elasticsearch'"
    exit 1
  fi
  # Installation via RPM
  ELASTICSEARCHBINARY=/usr/share/elasticsearch/bin/elasticsearch
else
  if ! which elasticsearch; then
    echo "No elasticsearch binary in path"
    exit 1
  fi
  ELASTICSEARCHBINARY=elasticsearch #assume path lookup will find it
fi

INITIALMEMORY=`wh registry get consilio.builtinelasticsearch.initialmemorypool`
if [ "$INITIALMEMORY" == "0" ]; then
  INITIALMEMORY=300
fi

MAXIMUMMEMORY=`wh registry get consilio.builtinelasticsearch.maximummemorypool`
if [ "$MAXIMUMMEMORY" == "0" ]; then
  MAXIMUMMEMORY=2000
fi

export _JAVA_OPTIONS="-Xms${INITIALMEMORY}m -Xmx${MAXIMUMMEMORY}m"

if [ -n "$WEBHARE_IN_DOCKER" ]; then
  exec chpst -u elasticsearch:elasticsearch:whdata "$ELASTICSEARCHBINARY" -Epath.data="$ELASTICSEARCHROOT/data" -Epath.logs="$ELASTICSEARCHROOT/logs" -Epath.repo="$ELASTICSEARCHROOT/repo" -Ehttp.port=$ELASTICSEARCHPORT -Ediscovery.type=single-node
else
  exec "$ELASTICSEARCHBINARY" -Epath.data="$ELASTICSEARCHROOT/data" -Epath.logs="$ELASTICSEARCHROOT/logs" -Epath.repo="$ELASTICSEARCHROOT/repo" -Ehttp.port=$ELASTICSEARCHPORT -Ediscovery.type=single-node
fi

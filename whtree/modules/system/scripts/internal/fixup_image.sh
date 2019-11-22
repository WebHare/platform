#!/bin/bash

# Inside the Docker image: /opt/wh/whtree/modules/system/scripts/internal/fixup_image.sh

# This script configured the docker image. Once (parts) are stable, they may be moved higher in the image (before WH compilation)

cd `dirname $0`
# We are in whtree/modules/system/scripts/internal, we need to find whtree, so 4 up!
cd ../../../..
WHTREE="`pwd`"

if [ -z "$WEBHARE_IN_DOCKER" ]; then
  echo "This script should only be run by Docker builds"
  exti 1
fi

# Group for WebHare's data directory. Not fully used yet, but keeps chrome out of it
groupadd --gid 20000 whdata

# User and group for Chrome. We really want to keep a browser far away from our data
groupadd --gid 20001 chrome
useradd --create-home --uid 20001 --gid 20001 --shell /bin/false chrome

# User and group for Elasticsearch. already created in dockerfile, we just need to make sure elasticsearch can access its data folder
# ES has 20002
adduser elasticsearch whdata

# User and group for postgres. already created in dockerfile, we just need to make sure postgresql can access its data folder
# postgres has 20003
adduser postgres whdata

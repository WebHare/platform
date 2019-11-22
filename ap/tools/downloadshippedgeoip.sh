#!/bin/bash

# Download the base version of geoip we'll include in the docker image for faster start/less load from testframework on geoip servers
mkdir -p "$WEBHARE_DIR"/geoip
if ! curl https://geolite.maxmind.com/download/geoip/database/GeoLite2-City.tar.gz | ( cd "$WEBHARE_DIR"/geoip ; tar zx --strip-components 1) ; then
  echo Download or extraction of city database failed
  exit 1
fi
if ! curl https://geolite.maxmind.com/download/geoip/database/GeoLite2-Country.tar.gz | ( cd "$WEBHARE_DIR"/geoip ; tar zx --strip-components 1) ; then
  echo Download or extraction of country database failed
  exit 1
fi
touch "$WEBHARE_DIR"/geoip/*.mmdb #To make sure they're dated at 'now'. The files themselves in the tar are always 'older' than what we found on the URL.
exit 0

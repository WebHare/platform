# We can't mark this script as executable as it shouldn't be run on a build host

# Download the base version of geoip we'll include in the docker image for faster start/less load from testframework on geoip servers

mkdir -p "$WEBHARE_DIR"/geoip
cd "$WEBHARE_DIR"/geoip

for GETFILE in GeoLite2-City.tar.gz GeoLite2-Country.tar.gz ; do
  DLPATH=/tmp/downloads/$GETFILE
  URL="https://geolite.maxmind.com/download/geoip/database/$GETFILE"
  echo Downloading $URL

  if ! curl -fsS -o $DLPATH -z $DLPATH $URL ; then
    rm -f $DLPATH
    echo "Download of $GETFILE failed"
    exit 1
  fi
  if ! tar zx --strip-components 1 -f $DLPATH ; then
    echo Extraction of $GETFILE failed
    exit 1
  fi

  touch "$WEBHARE_DIR"/geoip/*.mmdb #To make sure they're dated at 'now'. The files themselves in the tar are always 'older' than what we found on the URL.
done

exit 0

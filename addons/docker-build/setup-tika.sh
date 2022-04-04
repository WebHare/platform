#!/bin/bash
set -e

# Download here: https://tika.apache.org/download.html
# Upload here: https://cms.webhare.dev/?app=publisher(/webhare.dev/build.webhare.dev/whbuild/)

if [ -z "$WHBUILD_DOWNLOADCACHE" ]; then
  echo WHBUILD_DOWNLOADCACHE not set
  exit 1
fi

GETFILE=tika-app-2.3.0.jar
mkdir -p "$WHBUILD_DOWNLOADCACHE"
DLPATH="$WHBUILD_DOWNLOADCACHE/$GETFILE"
DESTPATH="$WEBHARE_CHECKEDOUT_TO"/whtree/modules/system/data/engines/tika-app.jar

if ! curl -fsS -o "$DLPATH" -z "$DLPATH" https://build.webhare.dev/whbuild/$GETFILE ; then
  rm -f "$DLPATH"
  echo "Download failed"
  exit 1
fi


mkdir -p "$WEBHARE_CHECKEDOUT_TO"/whtree/modules/system/data/engines/

[ "$DLPATH" -nt "$DESTPATH" ] && cp -v "$DLPATH" "$DESTPATH"
exit 0

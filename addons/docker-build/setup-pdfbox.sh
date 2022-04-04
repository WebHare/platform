#!/bin/bash
set -e

# Download here: https://pdfbox.apache.org/download.cgi
# Upload here: https://cms.webhare.dev/?app=publisher(/webhare.dev/build.webhare.dev/whbuild/)

if [ -z "$WHBUILD_DOWNLOADCACHE" ]; then
  echo WHBUILD_DOWNLOADCACHE not set
  exit 1
fi

GETFILE=pdfbox-app-2.0.25.jar
mkdir -p "$WHBUILD_DOWNLOADCACHE"
DLPATH="$WHBUILD_DOWNLOADCACHE/$GETFILE"
DESTPATH="$WEBHARE_CHECKEDOUT_TO"/whtree/modules/system/data/engines/pdfbox-app.jar

if ! curl -fsS -o "$DLPATH" -z "$DLPATH" https://build.webhare.dev/whbuild/$GETFILE ; then
  rm -f "$DLPATH"
  echo "Download failed"
  exit 1
fi


mkdir -p "$WEBHARE_CHECKEDOUT_TO"/whtree/modules/system/data/engines/

# Delete old versions in data/engines - this only happens on source installs and can go after april 11, 2022
find "$WEBHARE_CHECKEDOUT_TO"/whtree/modules/system/data/engines/ -name 'pdfbox-app-*.jar' -exec rm {} \;

[ "$DLPATH" -nt "$DESTPATH" ] && cp -v "$DLPATH" "$DESTPATH"
exit 0

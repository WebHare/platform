#!/bin/bash
set -e

# Download here: https://pdfbox.apache.org/download.cgi
# Upload here: https://cms.webhare.dev/?app=publisher(/webhare.dev/build.webhare.dev/whbuild/)

if [ -z "$WHBUILD_DOWNLOADCACHE" ]; then
  echo WHBUILD_DOWNLOADCACHE not set
  exit 1
fi

ASSETROOT="$1"
GETVERSION="$2"

GETFILE=pdfbox-app-$GETVERSION.jar
mkdir -p "$WHBUILD_DOWNLOADCACHE"
DLPATH="$WHBUILD_DOWNLOADCACHE/$GETFILE"
DESTPATH="$WEBHARE_CHECKEDOUT_TO"/whtree/modules/system/data/engines/pdfbox-app.jar

if ! curl -fsS -o "$DLPATH" -z "$DLPATH" "${ASSETROOT}${GETFILE}" ; then
  echo "Primary download failed, attempting fallback location"
  if ! curl -fsS -o "$DLPATH" -z "$DLPATH" "https://dlcdn.apache.org/pdfbox/${GETVERSION}/${GETFILE}" ; then
    rm -f "$DLPATH"
    echo "Download failed"
    exit 1
  fi
fi


mkdir -p "$WEBHARE_CHECKEDOUT_TO"/whtree/modules/system/data/engines/

# Delete old versions in data/engines - this only happens on source installs and can go after april 11, 2022
find "$WEBHARE_CHECKEDOUT_TO"/whtree/modules/system/data/engines/ -name 'pdfbox-app-*.jar' -exec rm {} \;

[ "$DLPATH" -nt "$DESTPATH" ] && cp -v "$DLPATH" "$DESTPATH"
exit 0

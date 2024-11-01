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

mkdir -p "$WHBUILD_DOWNLOADCACHE" "$WEBHARE_CHECKEDOUT_TO"/whtree/libexec/

GETFILE=pdfbox-app-$GETVERSION.jar
DLPATH="$WHBUILD_DOWNLOADCACHE/$GETFILE"
DESTPATH="$WEBHARE_CHECKEDOUT_TO"/whtree/libexec/pdfbox-app.jar

if ! curl -fsS -o "$DLPATH" -z "$DLPATH" "${ASSETROOT}${GETFILE}" ; then
  echo "Primary download failed, attempting fallback location"
  if ! curl -fsS -o "$DLPATH" -z "$DLPATH" "https://dlcdn.apache.org/pdfbox/${GETVERSION}/${GETFILE}" ; then
    rm -f "$DLPATH"
    echo "Download failed"
    exit 1
  fi
fi

[ "$DLPATH" -nt "$DESTPATH" ] && cp -v "$DLPATH" "$DESTPATH"
exit 0

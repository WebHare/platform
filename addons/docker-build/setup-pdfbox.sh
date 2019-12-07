# We can't mark this script as executable as it shouldn't be run on a build host

GETFILE=pdfbox-app-2.0.11.jar
DLPATH=/tmp/downloads/$GETFILE

if ! curl -fsS -o $DLPATH -z $DLPATH https://build.webhare.dev/whbuild/$GETFILE ; then
  rm -f $DLPATH
  echo "Download failed"
  exit 1
fi

mkdir -p /opt/wh/whtree/modules/system/data/engines/
cp $DLPATH /opt/wh/whtree/modules/system/data/engines/pdfbox-app.jar

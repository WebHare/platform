# We can't mark this script as executable as it shouldn't be run on a build host

GETFILE=elasticsearch-oss-7.10.0-linux-x86_64.tar.gz
DLPATH=/tmp/downloads/$GETFILE

if ! curl -fsS -o $DLPATH -z $DLPATH https://build.webhare.dev/whbuild/$GETFILE ; then
  rm -f $DLPATH
  echo "Download failed"
  exit 1
fi

mkdir /opt/elasticsearch
tar zx -C /opt/elasticsearch --strip-components=1 -f $DLPATH
useradd --system --uid 20002 --user-group elasticsearch
chown -R elasticsearch /opt/elasticsearch

if ! runuser --user elasticsearch --group elasticsearch -- /opt/elasticsearch/bin/elasticsearch --version ; then
  echo "Install failed? Errorcode $? from 'elasticsearch --version'"
  exit 1
fi

exit 0

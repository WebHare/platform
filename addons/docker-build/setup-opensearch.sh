# We can't mark this script as executable as it shouldn't be run on a build host
# DL instructions from https://opensearch.org/docs/latest/opensearch/install/tar/
# DL packages from here - https://opensearch.org/downloads.html

# To locally test and debug changes to the OpenSearch build and initialization in docker:
# wh builddocker && wh testdocker --nocleanup --tag=-external -w local consilio

GETFILE=opensearch-2.1.0-linux-x64.tar.gz
DLPATH=/tmp/downloads/$GETFILE

if ! curl -fsS -o $DLPATH -z $DLPATH https://build.webhare.dev/whbuild/$GETFILE ; then
  rm -f $DLPATH
  echo "Download failed"
  exit 1
fi

mkdir /opt/opensearch
tar zx -C /opt/opensearch --strip-components=1 -f $DLPATH
chown -R opensearch /opt/opensearch

runuser --user opensearch --group opensearch -- /opt/opensearch/bin/opensearch --version
RETVAL="$?"
if [ "$RETVAL" != "0" ]; then
  echo "Install failed? Errorcode $RETVAL from 'opensearch --version'"
  exit 1
fi

runuser --user opensearch --group opensearch -- /opt/opensearch/bin/opensearch-plugin install analysis-icu
RETVAL="$?"
if [ "$RETVAL" != "0" ]; then
  echo "Install failed? Errorcode $RETVAL from analysis-icu installation"
  exit 1
fi

exit 0

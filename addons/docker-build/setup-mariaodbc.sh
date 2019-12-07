# We can't mark this script as executable as it shouldn't be run on a build host

GETFILE=mariadb-connector-odbc-3.0.3-ga-debian-x86_64.tar.gz
DLPATH=/tmp/downloads/$GETFILE

if ! curl -fsS -o $DLPATH -z $DLPATH https://build.webhare.dev/whbuild/$GETFILE ; then
  rm -f $DLPATH
  echo "Download failed"
  exit 1
fi

if ! tar -zxv -C /usr/local --strip-components 1 -f $DLPATH ; then
  echo Extraction failed
  exit 1
fi

cat >> /etc/odbcinst.ini << HERE
[MariaDB]
Driver = /usr/local/lib/libmaodbc.so
Description = MariaDB ODBC Connector

HERE

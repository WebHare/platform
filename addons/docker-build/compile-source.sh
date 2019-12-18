# We can't mark this script as executable as it shouldn't be run on a build host

# License situation is unclear, Oracle seemed less requiring of EULA acceptance for just the download
# We can't distribute it but we can probably grab the assets needed for our codebuild and then clean it up again


DLPATH=/tmp/compile/downloads/instantclient.zip
mkdir -p /tmp/compile/downloads/

if [ -n "$WHBUILD_OCI" ]; then
  if ! curl -fsS -o $DLPATH -z $DLPATH $( cat /run/secrets/instantclienturl ) ; then
    rm -f $DLPATH
    echo "Download failed"
    exit 1
  fi

  mkdir -p /opt/instantclient
  cd /opt/instantclient
  if ! unzip -j $DLPATH ; then
    echo Unzip of $DLPATH failed
    exit 1
  fi

  for P in *.zip; do
    if ! unzip $P ; then
      echo Unzip of $P failed
      exit 1
    fi
  done

  cd /opt/instantclient/instantclient_10_2
  ln -sf libclntsh.so.10.1 libclntsh.so

  export WHBUILD_OCI=1
  export CPPFLAGS=-I/opt/instantclient/instantclient_10_2/sdk/include
  export GLOBALLDFLAGS=-L/opt/instantclient/instantclient_10_2/
fi

export CCACHE_DIR=/tmp/compile/ccache
export WHBUILD_NODEPS=1
export WHBUILD_ALLOW=1
export WHBUILD_LTO=1

if ! /opt/wh/whtree/bin/wh make install ; then
  echo BUILD FAILED
  exit 1
fi

rm -rf /opt/wh/{README.md,addons,ap,base_makefile,blex,drawlib,harescript,parsers}
rm -rf /opt/instantclient

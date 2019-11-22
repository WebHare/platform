#!/bin/sh -x

#
# This script is used internally by the escrow procedure
# If you want to create an escrow package, use the extract_escrow.sh script
#

# select the right tar implementation, we need gnu-tar
if [ "`uname`" == "Darwin" ]; then
  if ! which gtar >/dev/null 2>&1 ; then
    brew install gnu-tar
  fi

  TAR=gtar
else
  TAR=tar
fi

NOW=`date +%Y%m%dT%H%M`
ESCROW_TARGZ=webhare-escrow-${VERSION}-${NOW}.tar.gz

echo Clearing old escrow targets
rm -rf -- /tmp/escrow-construct-*
BUILDFOLDER=/tmp/escrow-construct-$$

echo Copying files for escrow targz in $BUILDFOLDER
mkdir -p $BUILDFOLDER/webhare
if ! ( cd $WHBUILD_SRCDIR ; git archive --format=tar ${uploadStash:-HEAD} . ) | ( cd $BUILDFOLDER/webhare ; $TAR x ) ; then
  echo "tar failed"
  exit 1
fi

pushd $BUILDFOLDER
mkdir whbuild
cat << HERE > whbuild/Makefile
# Generated escrow makefile
# WebHare version: ${VERSION}
# Created on: ${NOW}

# The location of the WebHare source code
SRCDIR=../webhare

# Run the full makefile
include ../webhare/base_makefile

HERE

echo Creating $BUILDFOLDER/${ESCROW_TARGZ}
tar zcf ${ESCROW_TARGZ} webhare whbuild
popd
cp -v $BUILDFOLDER/${ESCROW_TARGZ} .

if which md5sum >/dev/null 2>&1 ; then
  md5sum ${ESCROW_TARGZ} > ${ESCROW_TARGZ%.tar.gz}.md5
else
  md5 ${ESCROW_TARGZ} > ${ESCROW_TARGZ%.tar.gz}.md5
fi

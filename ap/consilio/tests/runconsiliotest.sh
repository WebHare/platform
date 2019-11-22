#!/bin/sh
TESTDIR=`mktemp -d`
cp "${WHBUILD_SRCDIR}/ap/consilio/tests/data"/* "${TESTDIR}/"
bin/consiliotest ${TESTDIR}
EXITCODE=$?
rm -r "$TESTDIR"
exit $EXITCODE

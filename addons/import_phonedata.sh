#!/bin/bash

SRCDIR=""
DESTDIR=""

# We assume you cloned https://github.com/google/libphonenumber to ~/projects/libphonenumber or ~/projects/external/libphonenumber

# Add other potential dirs here
for P in ~/projects/libphonenumber ~/projects/external/libphonenumber; do
  if [ -f "$P/resources/PhoneNumberMetadata.xml" ]; then
    SRCDIR="$P"
    break
  fi
done

if [ -z "$SRCDIR" ]; then
  echo "Cannot find libphonenumber source directory"
  exit 1
fi

GITREF=$(cd $SRCDIR ; git rev-parse HEAD)
if [ -z "$GITREF" ]; then
  echo "Cannot find git hash for flags source"
  exit 1
fi

DESTDIR="$(wh getmoduledir wrd)"
if [ -z "$DESTDIR" ]; then
  echo "Cannot find module wrd directory"
  exit 1
fi

DESTDIR="$DESTDIR/data/phonedata/"
rm -rf -- "$DESTDIR"
mkdir -p -- "$DESTDIR"

cp -r "$SRCDIR/resources/PhoneNumberMetadata.xml" $DESTDIR || ( echo "Failed to copy metadata file" && exit 1 )
cp $SRCDIR/LICENSE $DESTDIR/ || ( echo "Failed to copy license" && exit 1 )

cat >> $DESTDIR/README.md << HERE
# Source

This phone number metadata file comes from https://github.com/google/libphonenumber, which is licensed under the Apache
License Version 2.0, see \`LICENSE\`. This license applies to all files in the current directory and below.

Run \`~/projects/webhare/addons/import_phonedata.sh\` to update the phone number metadata.

Last updated: `date` by $USER from $GITREF

HERE

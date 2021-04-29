#!/bin/bash

SRCDIR=""
DESTDIR=""

# We assume you cloned https://github.com/lipis/flag-icon-css to ~/projects/flag-icon-css or ~/projects/external/flag-icon-css

# Add other potential dirs here
for P in ~/projects/flag-icon-css ~/projects/external/flag-icon-css; do
  if [ -d "$P/flags/1x1" -a -d "$P/flags/4x3" ]; then
    SRCDIR="$P"
    break
  fi
done

if [ -z "$SRCDIR" ]; then
  echo "Cannot find flags source directory"
  exit 1
fi

GITREF=$(cd $SRCDIR ; git rev-parse HEAD)
if [ -z "$GITREF" ]; then
  echo "Cannot find git hash for flags source"
  exit 1
fi

DESTDIR="$(wh getmoduledir publisher)"
if [ -z "$DESTDIR" ]; then
  echo "Cannot find module publisher directory"
  exit 1
fi

DESTDIR="$DESTDIR/web/common/countryflags/"
rm -rf -- "$DESTDIR"
mkdir -p -- "$DESTDIR"

cp -r "$SRCDIR/flags/1x1" "$SRCDIR/flags/4x3" $DESTDIR || ( echo "Failed to copy flags" && exit 1 )
cp $SRCDIR/LICENSE $DESTDIR/ || ( echo "Failed to copy license" && exit 1 )

cat >> $DESTDIR/README.md << HERE
# Source

These SVG flags come from https://github.com/lipis/flag-icon-css, which is
MIT-licensed, see \`LICENSE\`. This license applies to all files in the current
directory and below.

Run \`~/projects/webhare/addons/import_flags.sh\` to update these flags

Last updated: `date` by $USER from $GITREF

HERE

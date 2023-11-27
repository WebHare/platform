#!/bin/bash
source "${BASH_SOURCE%/*}/../whtree/lib/make-functions.sh"

DESTDIR=

while [[ $1 =~ ^-.* ]]; do
  if [ "$1" == "--dest" ]; then
    shift
    DESTDIR="$1"
  else
    echo "Illegal option $1"
    exit 1
  fi
  shift
done

set -e
setup_builddir
[ -d "$WEBHARE_CHECKEDOUT_TO/whtree/jssdk" ] || die "Cannot find the JSSDK, directory structure changed?"

rm -rf -- "$WEBHARE_BUILDDIR/jssdk"
mkdir -p "$WEBHARE_BUILDDIR/jssdk"

# Build the esbuild-runner first
PACKAGES="ts-esbuild-runner std"

# Throw the packages in place
for PACKAGE in $PACKAGES ; do
  cp -r -- "$WEBHARE_CHECKEDOUT_TO/whtree/jssdk/$PACKAGE" "$WEBHARE_BUILDDIR/jssdk/"
done

# Build them
for PACKAGE in $PACKAGES ; do
  cd "$WEBHARE_BUILDDIR/jssdk/$PACKAGE"
  npm install --omit=dev

  #FIXME build a proper browser version too where needed by the package
  SRC="$(< package.json jq -r .main)"
  DIST="dist/$PACKAGE.js"
  DISTTYPES="dist/$PACKAGE.d.ts"
  mkdir -p dist

  cat << HERE >> tsconfig.json
  {
    "extends": "$WEBHARE_CHECKEDOUT_TO/whtree/tsconfig.json",
    "include": ["$SRC"],
    "compilerOptions": {
      "noEmit": false,
      "declaration": true,
      "module": "commonjs",
      "typeRoots": ["$WEBHARE_CHECKEDOUT_TO/whtree/node_modules/@types"]
    }
  }
HERE

  if [ "$PACKAGE" != "ts-esbuild-runner" ]; then #TODO perhaps ts-esbuild-runner can actually use our paths here too
    # add --showConfig to dump final configuration
    # add --traceResolution to debug import lookups
    "$WEBHARE_CHECKEDOUT_TO/whtree/node_modules/.bin/tsc" --outDir "dist/"
  fi

  jq ".main = \"$DIST\"" package.json > package.json.tmp
  mv package.json.tmp package.json

  cat << HERE >> .npmignore
*.ts
*.tsx
tsconfig.json
!dist/*
HERE

  npm pack --foreground --pack-destination "$WEBHARE_BUILDDIR/jssdk"
done

if [ -n "$DESTDIR" ]; then
  mv "$WEBHARE_BUILDDIR/jssdk"/*.tgz "$DESTDIR"
fi

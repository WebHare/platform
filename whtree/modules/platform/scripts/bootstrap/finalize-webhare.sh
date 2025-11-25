#!/bin/bash

# finalize-webhare sets up all generated files in the source ($WEBHAREDIR) directory
# we will normally be invoked by `wh finalize-webhare`
#
# We need to be in shell script as TypeScript isn't available yet - we're bootstrapping TS support!
#
# package.json updates may require a `wh finalize-webhare --update-packages`

set -eo pipefail

export WEBHARE_HARESCRIPT_OFF=1 # Avoid any invocation of HareScript to ensure as much of finalization is safely HS-free

UPDATE_PACKAGES=
while [ "$1" != "" ]; do
  if [ "$1" == "--update-packages" ]; then
    UPDATE_PACKAGES=1
    shift
  else
    echo "Invalid argument: $1"
    exit 1
  fi
done

cd "${BASH_SOURCE%/*}/../../../.." || exit 1  #take us to whtree/
source "lib/wh-functions.sh"

[ -f package.json ] || die "Failed to navigate to whtree directory"
[ -n "$WEBHARE_HSBUILDCACHE" ] || die "WEBHARE_HSBUILDCACHE not set"
[ -n "$WEBHARE_TSBUILDCACHE" ] || die "WEBHARE_TSBUILDCACHE not set"

# Set up a dummy dataroot, some subcommands check it (eg 'wh run')
WEBHARE_DATAROOT="$(mktemp -d)"
mkdir -p "$WEBHARE_DATAROOT"
export WEBHARE_DATAROOT
logWithTime "Finalizing WebHare in $WEBHARE_DATAROOT"

getwebhareversion

if [[ "$(npm -v)" =~ ^11.6.[12]$ ]]; then
  echo "Buggy version of npm installed! Buggy versions are 11.6.1 and 11.6.2, current version: $(npm -v)"
  if [ -z "$WEBHARE_IN_DOCKER" ]; then
    echo "Please upgrade to 11.6.3 (npm -g i npm@11.6.3)"
  fi
  die "Buggy npm version installed"
fi

# Install node_modules
NPMOPTS=(--ignore-scripts --omit=dev --omit=peer --foreground-scripts)
if [ -n "$UPDATE_PACKAGES" ]; then
  logWithTime "Install all packages and updating package-lock.json if needed"
else
  logWithTime "Install all packages"
  NPMOPTS+=(--no-save)
fi
npm install "${NPMOPTS[@]}" || die "NPM install failure for $CANDIDATE"

# run scripts we trust and need explicitly.
## download the esbuild for this platform
logWithTime "Downloading esbuild"
node node_modules/esbuild/install.js || die "Download failed"

## generate root tsconfig.json
node_modules/.bin/yaml --json --single --strict < tsconfig.yml | jq > tsconfig.json

## download sharp
(cd node_modules/sharp && npm run install)
node -e 'require("sharp")' || die "Sharp failed"

## download puppeteer
logWithTime "Downloading puppeteer"
(cd node_modules/puppeteer && npm run postinstall)


## get dependencies for the postgresql-client
logWithTime "Setup postgresql-client"
( cd jssdk/whdb/vendor/postgrejs && npm install --no-save --ignore-scripts --omit=dev --omit=peer ) || die "postgresql-client install failure"

logWithTime "Build the resolveplugin"
modules/platform/scripts/bootstrap/build-resolveplugin.sh || die "Failed to setup the resolveplugin"

# When running from source, rebuild buildinfo (for docker builddocker.sh generates this, we may no longer have access to git information)
[ -z "$WEBHARE_IN_DOCKER" ] && generatebuildinfo

# We need a minimal wh apply to get the symlinks/tsconfig in place. WEBHARE_HARESCRIPT_OFF=1 to abort on any accidental HS attempt (we can't do HS yet - there's no compiler running and precompilation is the next step)
# After this step, 'wh node' should be available.
logWithTime "Generate minimal config to bootstrap WebHare"
WEBHARE_NO_CONFIG=1 wh apply --nodb --offline config.base

# verify the binary works. depends on 'wh node' working
logWithTime "Verifying the browser"
BROWSER="$(wh node -e 'console.log(require("puppeteer").executablePath())')"
if [ -z "$BROWSER" ]; then
  echo "Puppeteer executablePath() failed, cannot find browser"
  exit 1
fi

if [ ! -x "$BROWSER" ]; then
  echo "Puppeteer executablePath() returned '$BROWSER', but that file is not executable"
  exit 1
fi

if [ -n "$WEBHARE_IN_DOCKER" ]; then # verify using 'ldd', this is helpful when chasing down missing dependencies
  MISSINGLIBS="$(ldd "$BROWSER" | grep not || true)"
  if [ -n "$MISSINGLIBS" ]; then
    echo "Some dependencies are missing! Update CHROMEDEPS in setup-imagebase.sh"
    echo "$MISSINGLIBS"
    exit 1
  fi
fi

if ! wh run mod::platform/scripts/bootstrap/test-puppeteer.ts ; then
  echo "Screenshot failed. The browser may be broken? (architecture = $(uname -m))"
  if [ "$(uname -m)" == "aarch64" ]; then
    echo "Ignoring on linux ARM (aarch64) - puppeteer and thus WebHare is unsupported there. See also https://github.com/puppeteer/puppeteer/issues/7740"
  else
    exit 1
  fi
fi

export WEBHARE_HARESCRIPT_OFF= # Re-enable HS

# HS precompile. This *must* be done before any attempt at running WASM engine HS code as they can't run without a live whcompile
rm -rf "$WEBHARE_HSBUILDCACHE" 2>/dev/null || true # Mostly useful on dev machines so the direct__ check later doesn't fail you. Ignore errors, usually triggered by racing a running WebHare
(
  cd "$WEBHARE_DIR/modules" ;
  # shellcheck disable=SC2207,SC2010
  COREMODULES=( $(ls | grep -Ev '^(webhare_testsuite|devkit)$') )

  logWithTime "Precompiling HareScript code"

  [ -z "$WHBUILD_DISALLOW_INTERRUPT" ] && trap "" INT  #Ignore CTRL+C to allow to abort just this step. But only if you wh finalize-webhare - wh make will block this as it also aborts make
  exitcode=0
  wh compile --quiet --onlyerrors "${COREMODULES[@]}" || exitcode="$?"
  trap - INT

  if [ "$exitcode" == "130" ]; then
    logWithTime "HareScript compile interrupted"
  elif [ "$exitcode" != "0" ] && [ "$exitcode" != "194" ]; then
    if [ -n "$WEBHARE_IGNORE_RUNNING" ]; then
      # wh -i finalize-webhare was used.. that'll always race against the running compiler so ignore build errors
      logWithTime "Ignoring failed compilation as WebHare may have been running during compilation"
    else
      logWithTime "HareScript compile failed"
      exit 1
    fi
  fi

  for MODULE in "${COREMODULES[@]}"; do
    logWithTime "Creating history for module $MODULE" #TODO used for hotfix detection but can't we just go for a manifest based on modtimes and leave it at that ?
    mkdir -p "$MODULE/history"
    TZ=UTC zip --quiet --exclude "$MODULE/history/*" --exclude "platform/generated/*"  --recurse-paths "$MODULE/history/source.zip" "$MODULE"
  done
)

# This sets up @mod-platform/generated (so both config & dev are needed). It may also set up more whdata/config files but that will be discarded anyway (as whdata is temporary folder when finalizing WebHare)
logWithTime "Generate all config files"
wh apply --nodb --offline config

# Precompile TypeScript. As long as we don't have something like wrd() to ensure we can do type-only import of generated files we need to do precompile *after* generating config files to ensure the generatd TS files are precompiled too
logWithTime "Precompiling TypeScript"
rm -rf "$WEBHARE_TSBUILDCACHE" 2>/dev/null || true # ignore errors, often triggered by rebuilding while active
wh run "$WEBHARE_DIR/jssdk/tsrun/src/precompile.ts" "$WEBHARE_TSBUILDCACHE" "$WEBHARE_DIR"

logWithTime "Prepare whdata, ensure @mod- paths work" # this result will be discarded but it's needed to bootstrap TS/HS code
"$WEBHARE_DIR/modules/platform/scripts/bootstrap/prepare-whdata.sh"

logWithTime "Compress country flags" #TODO brotli them! easiest to do this using node, as that one ships with brotli
gzip --keep --force "$WEBHARE_DIR/node_modules/flag-icons/flags/"*/*.svg

logWithTime "Rebuild plaform:* assetpacks"
rm -rf "$WEBHARE_DIR/modules/platform/generated/ap" "$WEBHARE_DIR/modules/platform/generated/ap.metadata" 2>/dev/null || true # ignore errors, often triggered by rebuilding while active
wh assetpack compile --foreground "platform:*"

logWithTime "Final checks"
if ls "$WEBHARE_HSBUILDCACHE"/*direct* >/dev/null 2>&1 ; then
  echo "Found direct files in the compile cache."
  ls "$WEBHARE_HSBUILDCACHE"/*direct*
  exit 1
fi

logWithTime "Finalize done"
exit 0

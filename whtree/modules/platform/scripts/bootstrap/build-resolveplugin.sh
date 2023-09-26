# Use `wh finalize-webhare` to force a rebuild of the resolve plugign

cd "${BASH_SOURCE%/*}/../../../.." || exit 1  #take us to whtree/

# Clear the esbuild cache so the new plugin has fresh data to work with
# This variable is only set if we're invoked with `wh finalize-webhare`
if [ -d "${WEBHARE_TSBUILDCACHE}" ] ; then
  echo "Clearing ts-esbuild-runner compile cache in ${WEBHARE_TSBUILDCACHE}"
  rm -rf -- "${WEBHARE_TSBUILDCACHE}"
fi

# Manually run the install script for @webhare/ts-esbuild-runner
echo Running ts-esbuild-runner prepack to install the plugin
"jssdk/ts-esbuild-runner/bin/prepack.sh"

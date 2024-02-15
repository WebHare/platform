#!/bin/bash
set -eo pipefail
SCRIPTPATH="$(dirname "$(realpath "${BASH_SOURCE[0]}")")"
export NODE_OPTIONS="--enable-source-maps --require \"${SCRIPTPATH}/../dist/resolveplugin.js\" $NODE_OPTIONS"
exec node "$@"

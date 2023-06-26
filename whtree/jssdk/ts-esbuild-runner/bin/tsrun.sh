#!/bin/bash
set -eo pipefail
export NODE_OPTIONS="--enable-source-maps --require \"${BASH_SOURCE%/*}/../dist/resolveplugin.js\" $NODE_OPTIONS"
exec node "$@"

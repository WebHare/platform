#!/bin/bash

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")" || exit 1

podman run \
  --rm \
  --privileged \
  -ti \
  -v "$(pwd)/../..":/opt/wh \
  -v "devcontainer-currentinstall":/opt/wh/whtree/currentinstall \
  -v "devcontainer-node_modules":/opt/wh/whtree/node_modules \
  localhost/webhare/platform:devcontainer \
  "$@"

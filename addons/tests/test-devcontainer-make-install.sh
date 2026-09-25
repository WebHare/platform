#!/bin/bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"/../.. || exit 1

addons/docker-build/build-devcontainer.sh
addons/docker-build/run-devcontainer.sh wh make install

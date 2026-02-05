#!/bin/bash
# TODO port to JS (See the various other cli tests), rename to reflect wh bridge->debug
# wh runtest system.nodejs.test_wh_bridge_cli
source "${WEBHARE_DIR}/lib/wh-functions.sh"

testEq "1" "$(wh debug list-processes --json |jq -r 'map(select (.name|endswith("cli-commands/debug.ts"))) | length')"
exit 0

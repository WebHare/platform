#!/bin/bash
# wh runtest system.nodejs.test_wh_bridge_cli
source "${WEBHARE_DIR}/lib/wh-functions.sh"

testEq "1" "$(wh bridge connections --json|jq -r 'map(select (.name|endswith("whcommands/bridge.ts"))) | length')"
exit 0

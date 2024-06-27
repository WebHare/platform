#!/bin/bash

# This script is currently unused but keeping it in case someone wants to dive in and reenable separate browser caching
# It broke earlier because @puppeteer/browsers in an earlier stage isn't actually guaranteed to sync up with whe specific puppeteer version package.json points to
npx @puppeteer/browsers install chrome@stable --path "$PUPPETEER_CACHE_DIR" < /dev/null
BINARY="$(find "$PUPPETEER_CACHE_DIR" -name chrome -type f -executable)"

if [ -z "$BINARY" ]; then
  echo Chrome download failed?
  exit 1
fi

MISSINGLIBS="$(ldd "$BINARY" | grep not)"
if [ -n "$MISINGLIBS" ]; then
  echo Some dependencies are missing! Update CHROMEDEPS in setup-imagebase.sh
  echo "$MISSINGLIBS"
  exit 1
fi

if ! "$BINARY" --headless --no-sandbox --screenshot=/tmp/chrome.png https://www.example.com/ ; then
  echo "Screenshot failed. Chrome may be broken?"
  exit 1
fi

exit 0

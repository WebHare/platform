#!/bin/bash
echo "Running monthly WebHare cleanup"

# NOTE: Do NOT do any cleanups that a prod webhare should also need (Eg old consilio indices) - those should go into proper WebHare scripts
if [ -d "$WEBHARE_DATAROOT/ephemeral/babelcache" ]; then
  mv "$WEBHARE_DATAROOT/ephemeral/babelcache" "$WEBHARE_DATAROOT/ephemeral/deleteme-bc"-$$-"$(date +%F%T)"
fi

if [ -d "$WEBHARE_DATAROOT/ephemeral/compilecache" ]; then
  mv "$WEBHARE_DATAROOT/ephemeral/compilecache" "$WEBHARE_DATAROOT/ephemeral/deleteme-cc"-$$-"$(date +%F%T)"
fi

nohup rm -rf "$WEBHARE_DATAROOT/ephemeral/deleteme-"* >/dev/null 2>/dev/null

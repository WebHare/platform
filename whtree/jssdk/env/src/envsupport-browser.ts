import * as domcookie from 'dompack/extra/cookie';

export function getDefaultRPCBase() {
  return location.origin + "/";
}

function getWHDebugFlags() {
  const flags: { [key: string]: boolean } = {};

  const urldebugvar = new URL(location.href).searchParams.get("wh-debug");
  if (urldebugvar)
    for (const flag of urldebugvar.split(','))
      flags[flag] = true;

  const debugcookie = domcookie.read("wh-debug");
  if (debugcookie)
    for (const flag of debugcookie.split('.'))
      if (!flag.startsWith('sig='))
        flags[flag] = true;

  return flags;
}

export const flags = getWHDebugFlags();

export function registerDebugConfigChangedCallback(cb: () => void) {
  // no implementation in the browser
}

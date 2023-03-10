import { getCookie } from '@webhare/dompack';

export function getEnvironmentDebugFlags(): string[] {
  const flags = [];
  const urldebugvar = new URL(location.href).searchParams.get("wh-debug");
  if (urldebugvar)
    flags.push(...urldebugvar.split(','));

  const debugcookie = getCookie("wh-debug");
  if (debugcookie)
    flags.push(... (debugcookie.split('.').filter(flag => !flag.startsWith('sig='))));

  return flags;
}

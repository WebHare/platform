export function getEnvironmentDebugFlags(): string[] {
  const flags = [];
  const urldebugvar = new URL(location.href).searchParams.get("wh-debug");
  if (urldebugvar)
    flags.push(...urldebugvar.split(','));

  //not importing getCookie to solve some import ordering issues
  if (typeof document !== "undefined") { //'document' is undefined in a worker but assetpacks compiled for a ServiceWorker will also load us
    const debugcookie = document.cookie.match('(?:^|;)\\s*wh-debug=([^;]*)');
    if (debugcookie) {
      const debugcookievalue = decodeURIComponent(debugcookie[1]);
      if (debugcookievalue)
        flags.push(... (debugcookievalue.split('.').filter(flag => !flag.startsWith('sig='))));
    }
  }

  return flags;
}

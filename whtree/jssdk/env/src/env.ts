import { flags, registerDebugConfigChangedCallback } from "./envbackend";
import { hookFetch } from "./fetchdebug";
import * as envsupport from "./envsupport";

export { flags } from "./envbackend";

/** Get the default base URL for RPCs
    @returns In the browser this returns the current root, in the backend it returns primary WebHare url. Always ends with a slash */
export function getDefaultRPCBase() {
  return envsupport.getDefaultRPCBase();
}

// Hook fetch if requested
if (globalThis["fetch"]) {
  if (flags.wrq)
    hookFetch();

  registerDebugConfigChangedCallback(() => {
    if (flags.wrq)
      hookFetch();
  });
}

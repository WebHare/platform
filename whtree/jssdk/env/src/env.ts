import { flags } from "./envbackend";
import * as envsupport from "./envsupport";

export { flags } from "./envbackend";


/** Get the default base URL for RPCs
    @returns In the browser this returns the current root, in the backend it returns primary WebHare url. Always ends with a slash */
export function getDefaultRPCBase() {
  return envsupport.getDefaultRPCBase();
}

let hookedfetch = false;

function hookFetch() {
  const originalfetch = globalThis.fetch;
  globalThis.fetch = async function(input: RequestInfo | URL, init?: RequestInit) {
    const method = init?.method || "GET";
    const url = input instanceof URL ? input.toString() : input;
    if (flags.wrq)
      console.log(`[wrq] Request: ${method} ${url}`);

    return originalfetch(input, init); //TODO log responses as well (if safe/applicable, eg not binary or Very Long... and we probably should wait for the first json()/text()/body() call? but at least log the status and time!)
  };
  hookedfetch = true;
}

if (globalThis["fetch"]) {
  if (flags.wrq)
    hookFetch();

  envsupport.registerDebugConfigChangedCallback(() => {
    if (flags.wrq && !hookedfetch)
      hookFetch();
  });
}

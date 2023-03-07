import * as envsupport from "./envsupport";

/// An object with string keys and typed values
interface WellKnownFlags {
  /** Log RPcs */
  rpc?: true;
  /** Log web traffic */
  wrq?: true;
  /** Autoprofile */
  apr?: true;
  /** IPC */
  ipc?: true;
}
type DebugFlags = WellKnownFlags & { [key: string]: true };

export const flags: DebugFlags = envsupport.getWHDebugFlags() as DebugFlags;

/** Get the default base URL for RPCs
    @returns In the browser this returns the current root, in the backend it returns primary WebHare url. Always ends with a slash */
export function getDefaultRPCBase() {
  return envsupport.getDefaultRPCBase();
}

if (flags.wrq && globalThis.fetch) { //Hook fetch to console.log all requests
  const originalfetch = globalThis.fetch;
  globalThis.fetch = async function(input: RequestInfo | URL, init?: RequestInit) {
    const method = init?.method || "GET";
    const url = input instanceof URL ? input.toString() : input;
    console.log(`[wrq] Request: ${method} ${url}`);

    return originalfetch(input, init); //TODO log responses as well (if safe/applicable, eg not binary or Very Long... and we probably should wait for the first json()/text()/body() call? but at least log the status and time!)
  };
}

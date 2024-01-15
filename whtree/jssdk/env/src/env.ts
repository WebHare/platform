import { debugFlags, registerDebugConfigChangedCallback } from "./envbackend";
import { hookFetch } from "./fetchdebug";
import { DTAPStage } from "./concepts";
import * as envsupport from "./envsupport";

export { debugFlags, type DebugFlags } from "./envbackend";
export { DTAPStage } from "./concepts";

/** DTAP stage set for this WebHare */
export const dtapStage: DTAPStage = envsupport.getDtapStage();
/** Whether we should (pretend) to be live/production ... true on production and acceptance */
export const isLive = dtapStage == "production" || dtapStage == "acceptance";

export const flags = debugFlags; //TODO Deprecate once 5.4 is the expected baseline everywhere
export const dtapstage = dtapStage; //TODO Deprecate once 5.4 is the expected baseline everywhere
export const islive = isLive; //TODO Deprecate once 5.4 is the expected baseline everywhere

/** Get the default base URL for RPCs
    @returns In the browser this returns the current root, in the backend it returns primary WebHare url. Always ends with a slash */
export function getDefaultRPCBase() {
  return envsupport.getDefaultRPCBase();
}

// Hook fetch if requested
if (globalThis["fetch"]) {
  if (debugFlags.wrq)
    hookFetch();

  registerDebugConfigChangedCallback(() => {
    if (debugFlags.wrq)
      hookFetch();
  });
}

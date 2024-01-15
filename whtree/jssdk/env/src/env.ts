import { debugFlags, registerDebugConfigChangedCallback, dtapStage, isLive } from "./envbackend";
import { hookFetch } from "./fetchdebug";
import { DTAPStage } from "./concepts";

export { DTAPStage, dtapStage, debugFlags, isLive };

//export deprecated variants
export { dtapstage, islive } from "./envbackend";

// Hook fetch if requested
if (globalThis["fetch"]) {
  if (debugFlags.wrq)
    hookFetch();

  registerDebugConfigChangedCallback(() => {
    if (debugFlags.wrq)
      hookFetch();
  });
}

/** @deprecated For WH5.4 and up use 'debugFlags' */
export const flags = debugFlags;

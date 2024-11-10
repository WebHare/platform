import { debugFlags } from "@webhare/env";

/** @deprecated  Use debugFlags from \@webhare/env */
const debugflags = debugFlags;
export { debugflags };

//Add all flags as a dompack-debug-- class
if (typeof document !== 'undefined')
  document.documentElement.classList.add(...Object.keys(debugFlags).map(flagname => "dompack--debug-" + flagname));
if (debugFlags.dompack)
  console.log('[dompack] debugging flags: ' + Object.keys(debugFlags).join(', '));

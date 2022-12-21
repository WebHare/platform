import { flags } from "@webhare/env";
export { flags as debugflags } from "@webhare/env";

//Add all flags as a dompack-debug-- class
document.documentElement.classList.add(...Object.keys(flags).map(flagname => "dompack--debug-" + flagname));
if (flags.dompack)
  console.log('[dompack] debugging flags: ' + Object.keys(flags).join(', '));

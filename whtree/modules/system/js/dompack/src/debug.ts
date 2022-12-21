import { flags } from "@webhare/env";
export { flags as debugflags } from "@webhare/env";

if (flags.dompack)
  console.log('[dompack] debugging flags: ' + Object.keys(flags).join(', '));

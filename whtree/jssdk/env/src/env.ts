// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/env" {
}

import { debugFlags, dtapStage, isLive, backendBase } from "./envbackend";
import { DTAPStage } from "./concepts";

export { type NavigateInstruction, navigateTo } from "./navigation";
export { enableFetchDebugging } from "./fetchdebug";
export { DTAPStage, dtapStage, debugFlags, isLive, backendBase };

//export deprecated variants
export { dtapstage, islive } from "./envbackend";

/** @deprecated For WH5.4 and up use 'debugFlags' */
export const flags = debugFlags;

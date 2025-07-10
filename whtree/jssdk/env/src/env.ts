// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/env" {
}

import { debugFlags, dtapStage, isLive, backendBase } from "./envbackend";
import type { DTAPStage } from "./concepts";

export { type NavigateInstruction, navigateTo } from "./navigation";
export { enableFetchDebugging } from "./fetchdebug";
export { type DTAPStage, dtapStage, debugFlags, isLive, backendBase };

//user locale *which Tollium and sites should start to use to define localization, and perhaps gettid too?)
export type UserLocale = {
  /** The language code, eg 'en' including optional country, eg en-US */
  lang: string;
  //TODO regional settings
};

//export deprecated variants
export { dtapstage, islive } from "./envbackend";

/** @deprecated For WH5.4 and up use 'debugFlags' */
export const flags = debugFlags;

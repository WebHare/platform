// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/js-api-tools" {
}

export { parseTrace, getStackTrace, prependStackTrace } from "./stacktracing";
export { getBestMatch, addBestMatch } from "./levenshtein";
export type { StackTrace, StackTraceItem } from "./stacktracing";
export type { DisallowExtraPropsRecursive, RecursiveReadonly, PromisifyFunctionReturnType, RecursivePartial } from "./utility-types";

import type { RecursiveReadonly } from "./utility-types";
/** @deprecated Switch to RecursiveReadonly in WH5.6 (matches TS Readonly casing) */
export type RecursiveReadOnly<T> = RecursiveReadonly<T>;

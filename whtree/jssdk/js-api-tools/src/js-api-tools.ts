export { checkPromiseErrorsHandled } from "./async";
export { parseTrace, getStackTrace, prependStackTrace } from "./stacktracing";
export { levenshteinDistance, getBestMatch, addBestMatch } from "./levenshtein";
export type { StackTrace, StackTraceItem } from "./stacktracing";
export type { RecursiveReadonly, PromisifyFunctionReturnType, RecursivePartial } from "./utility-types";

import type { RecursiveReadonly } from "./utility-types";
/** @deprecated Switch to RecursiveReadonly in WH5.6 (matches TS Readonly casing) */
export type RecursiveReadOnly<T> = RecursiveReadonly<T>;

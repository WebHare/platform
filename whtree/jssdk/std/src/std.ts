// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/std" {
}

// Adding APIs may also require an update to https://www.webhare.dev/manuals/typescript/harescript-conversion-guide/
export { attempt, sleep, createDeferred, wrapInTimeout, serialize, wrapSerialized, type DeferredPromise, type SerializeOptions } from "./promises.ts";

export { compare, compareProperties, nameToCamelCase, nameToSnakeCase, toSnakeCase, toCamelCase, maybePromiseAll } from "./types.ts";
export type { ToSnakeCase, ToCamelCase, ComparableType, MaybePromise } from "./types.ts";

export { encodeString, decodeString, escapeRegExp, regExpFromWildcards, stringify, parseTyped, slugify, isValidEmail, type StringEncodings, toCLocaleLowercase, toCLocaleUppercase, levenshteinDistance, getUTF8Length, limitUTF8Length, updateURL } from "./strings.ts";
export { generateRandomId, isLikeRandomId, isValidUUID } from "./platformbased.ts";

export { shuffle, emplace, pick, omit, isTruthy, appendToArray, typedEntries, typedFromEntries, typedKeys, SortedMultiSet, SortedMultiMap, type TypedEntries, type TypedFromEntries } from "./collections.ts";
export type { EmplaceHandler, DistributedKeys, DistributedOmit, DistributedPick } from "./collections.ts";

export { Money, type MoneyRoundingMode, type MoneyFormatOptions } from "./money.ts";

export { addDuration, parseDuration, subtractDuration, convertWaitPeriodToDate, isValidDate, isValidTime, convertFlexibleInstantToDate, formatDateTime } from "./datetime.ts";
export type { Duration, WaitPeriod, FlexibleInstant } from "./datetime.ts";

export { stdTypeOf, isDate, isBlob, isFile, isError, isPromise, isMoney, isTemporalInstant, isTemporalPlainDate, isTemporalPlainDateTime, isTemporalZonedDateTime, isTemporalPlainTime } from "./quacks.ts";

export { combineAbortSignals, getScopeSignal, whenAborted, pipe } from "./utils.ts";

export { LocalMutex, type LocalLock } from "./localmutex.ts";

/** Throw an error with the specified message. This function allows you to throw inside expressions
 * @param err - The error message
 * @returns This function never returns
 * @throws An error with the specified message
 */
export function throwError(err: Error | string): never {
  //TODO remove ourselves from the stack ?
  throw err instanceof Error ? err : new Error(err);
}

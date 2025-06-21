// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/std" {
}

// Adding APIs may also require an update to https://www.webhare.dev/manuals/typescript/harescript-conversion-guide/
export { sleep, createDeferred, wrapInTimeout, serialize, wrapSerialized, type DeferredPromise, type SerializeOptions } from "./promises";

export { compare, compareProperties, nameToCamelCase, nameToSnakeCase, toSnakeCase, toCamelCase } from "./types";
export type { ToSnakeCase, ToCamelCase, ComparableType } from "./types";

export { encodeString, decodeString, escapeRegExp, regExpFromWildcards, stringify, parseTyped, slugify, isValidEmail, isValidUrl, joinURL, type StringEncodings, toCLocaleLowercase, toCLocaleUppercase, levenshteinDistance } from "./strings";
export { generateRandomId, isLikeRandomId, isValidUUID } from "./platformbased";

export { shuffle, emplace, pick, omit, isTruthy, appendToArray, typedEntries, typedFromEntries, typedKeys, SortedMultiSet, SortedMultiMap, type TypedEntries, type TypedFromEntries } from "./collections";
export type { EmplaceHandler, DistributedKeys, DistributedOmit, DistributedPick } from "./collections";

export { Money, type MoneyRoundingMode, type MoneyFormatOptions } from "./money";
export { addDuration, parseDuration, subtractDuration, convertWaitPeriodToDate, isValidDate, isValidTime, convertFlexibleInstantToDate, type Duration, type WaitPeriod, type FlexibleInstant } from "./datetime";
export { stdTypeOf, isDate, isBlob, isFile, isError, isPromise, isMoney, isTemporalInstant, isTemporalPlainDate, isTemporalPlainDateTime, isTemporalZonedDateTime } from "./quacks";
export { type AddressValue } from "./address";

export { combineAbortSignals, whenAborted } from "./utils";

/** Throw an error with the specified message. This function allows you to throw inside expressions
 * @param err - The error message
 * @returns This function never returns
 * @throws An error with the specified message
 */
export function throwError(err: string): never {
  //TODO remove ourselves from the stack ?
  throw new Error(err);
}

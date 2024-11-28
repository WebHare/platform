// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/std" {
}

// Adding APIs may also require an update to https://www.webhare.dev/manuals/typescript/harescript-conversion-guide/
export { sleep, createDeferred, wrapInTimeout, serialize, wrapSerialized, type DeferredPromise, type SerializeOptions } from "./promises";
export { nameToCamelCase, nameToSnakeCase, toSnakeCase, toCamelCase, type ToSnakeCase, type ToCamelCase } from "./types";
export { encodeString, decodeString, escapeRegExp, regExpFromWildcards, stringify, parseTyped, slugify, isValidEmail, isValidUrl, joinURL, type StringEncodings, toCLocaleLowercase, toCLocaleUppercase, levenshteinDistance } from "./strings";
export { generateRandomId } from "./platformbased";
export { shuffle, emplace, pick, omit, isTruthy, mapGroupBy, objectGroupBy, type EmplaceHandler, type DistributedKeys, type DistributedOmit, type DistributedPick } from "./collections";
export { Money, type MoneyRoundingMode, type MoneyFormatOptions } from "./money";
export { addDuration, parseDuration, subtractDuration, convertWaitPeriodToDate, isValidDate, isValidTime, type Duration, type WaitPeriod } from "./datetime";
export { stdTypeOf, isDate, isBlob, isFile, isError, isPromise } from "./quacks";
export { type AddressValue } from "./address";

/** Throw an error with the specified message. This function allows you to throw inside expressions
 * @param err - The error message
 * @returns This function never returns
 * @throws An error with the specified message
 */
export function throwError(err: string): never {
  //TODO remove ourselves from the stack ?
  throw new Error(err);
}

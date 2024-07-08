// Adding APIs may also require an update to https://www.webhare.dev/manuals/typescript/harescript-conversion-guide/
export { sleep, createDeferred, wrapInTimeout, serialize, wrapSerialized, type DeferredPromise, type SerializeOptions } from "./promises";
export { encodeString, decodeString, escapeRegExp, wildcardsToRegExp, stringify, parseTyped, stableStringify, slugify, isValidEmail, joinURL, type StringEncodings } from "./strings";
export { generateRandomId } from "./platformbased";
export { shuffle, emplace, pick, omit, isTruthy, mapGroupBy, objectGroupBy, type EmplaceHandler } from "./collections";
export { Money, type MoneyRoundingMode, type MoneyFormatOptions } from "./money";
export { addDuration, parseDuration, convertWaitPeriodToDate, type Duration, type WaitPeriod } from "./datetime";
export { isDate, isBlob, isFile, isError, isPromise } from "./quacks";
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

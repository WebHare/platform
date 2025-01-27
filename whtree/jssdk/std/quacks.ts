//TODO can we replace ourselves with nodejs util.types in a pure NodeJS environment?

import type { Money } from "./money";

function isCrossRealm(value: unknown): value is object {
  return Boolean(value // it's not null
    && typeof value === "object" //and it's an object
    && !(value instanceof Object)); //and it's not an instance of our Object
}

/** Test whether a value looks like an instance of Money */
export function isMoney(value: unknown): value is Money {
  return Boolean((value as Money)?.["__ moneySymbol"]);
}

/** Test whether a value looks like an instance of Date (assumes no subclasses) */
export function isDate(value: unknown): value is Date {
  return value instanceof Date || (isCrossRealm(value) && value.constructor.name === "Date");
}

/** Test whether a value implements Blob */
export function isBlob(value: unknown): value is Blob {
  return value instanceof Blob || (isCrossRealm(value) && "size" in value && "type" in value && "slice" in value);
}

/** Test whether a value implements File */
export function isFile(value: unknown): value is File {
  return isBlob(value) && "name" in value;
}

/** Check if the object is probably an Error object. Can't use 'instanceof Error' as an Error might come from a different frame */
export function isError(e: unknown): e is Error {
  return e instanceof Error || (isCrossRealm(e) && "name" in e && "stack" in e && "message" in e);
}

/** Check if the object looks like a promise */
export function isPromise<T>(e: unknown): e is Promise<T> {
  return Boolean(e && typeof (e as Promise<unknown>).then === "function" && typeof (e as Promise<unknown>).catch === "function");
}

/** Check the type of a value, return its JS or STD type
 * @param value - The value to check
 * @returns The type of the value. If the value is an object but recognized as a Money, Date or Blob, that type is returned. If a value looks to be class-constructed, "instance" is returned
 */
export function stdTypeOf(value: unknown): "string" | "number" | "boolean" | "null" | "symbol" | "bigint" | "function" | "object" | "undefined" | "Date" | "Money" | "Array" {
  const t = typeof value;
  if (t === "object") {
    if (!value)
      return "null";
    if (Array.isArray(value))
      return "Array";
    if (isMoney(value))
      return "Money";
    if (isDate(value))
      return "Date";
  }
  return t;
}

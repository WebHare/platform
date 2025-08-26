//TODO can we replace ourselves with nodejs util.types in a pure NodeJS environment?

import type { Temporal } from "temporal-polyfill";
import type { Money } from "./money";

export function getWHType(obj: unknown): string | null { //not exporting this directly as we hope JS comes up with better solutions for instanceOf not being compatible with realms/reloading
  // Ideally we'd use symbol but it breaks tree shaking in esbuild, so this is our workaround. Reported as https://github.com/evanw/esbuild/issues/3940
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Can't cleanly type this it seems and it's low level anyway
  return (obj as any)?.constructor?.["__ $whTypeSymbol"] ?? null;
}

function isCrossRealm(value: unknown): value is object {
  return Boolean(value // it's not null
    && typeof value === "object" //and it's an object
    && !(value instanceof Object)); //and it's not an instance of our Object
}

/** Test whether a value looks like an instance of Money */
export function isMoney(value: unknown): value is Money {
  return getWHType(value) === "Money";
}

/** Test whether a value looks like an instance of Temporal.Instant */
export function isTemporalInstant(value: unknown): value is Temporal.Instant {
  return Boolean(value && typeof value === "object" && Symbol.toStringTag in value && value?.[Symbol.toStringTag] === 'Temporal.Instant');
}

/** Test whether a value looks like an instance of Temporal.PlainDateTime */
export function isTemporalPlainDateTime(value: unknown): value is Temporal.PlainDateTime {
  return Boolean(value && typeof value === "object" && Symbol.toStringTag in value && value?.[Symbol.toStringTag] === 'Temporal.PlainDateTime');
}

/** Test whether a value looks like an instance of Temporal.PlainDate */
export function isTemporalPlainDate(value: unknown): value is Temporal.PlainDate {
  return Boolean(value && typeof value === "object" && Symbol.toStringTag in value && value?.[Symbol.toStringTag] === 'Temporal.PlainDate');
}

/** Test whether a value looks like an instance of Temporal.ZonedDateTime */
export function isTemporalZonedDateTime(value: unknown): value is Temporal.ZonedDateTime {
  return Boolean(value && typeof value === "object" && Symbol.toStringTag in value && value?.[Symbol.toStringTag] === 'Temporal.ZonedDateTime');
}

/** Test whether a value looks like an instance of Date (assumes no subclasses) */
export function isDate(value: unknown): value is Date {
  return value instanceof Date || (isCrossRealm(value) && value.constructor.name === "Date");
}

/** Test whether a value appears to implement the Blob interface */
export function isBlob(value: unknown): value is Blob {
  return value instanceof Blob || Boolean(value && typeof value === "object" && "size" in value && "type" in value && "slice" in value && typeof value.slice === "function" && "stream" in value && typeof value.stream === "function");
}

/** Test whether a value appears to implement the File interface */
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
 * @returns The type of the value. If the value is an object but recognized as any of Money, Date, Blob, Temporal.Instant/PlainDate/PlainDateTime, that type is returned.
 */
export function stdTypeOf(value: unknown): "string" | "number" | "boolean" | "null" | "symbol" | "bigint" | "function" | "object" | "undefined" | "Date" | "Money" | "Array" | "Instant" | "PlainDate" | "PlainDateTime" | "ZonedDateTime" | "File" | "Blob" {
  const t = typeof value;
  if (t === "object") {
    if (!value)
      return "null";
    if (Array.isArray(value))
      return "Array";
    if (isMoney(value))
      return "Money";
    if (isBlob(value))
      return isFile(value) ? "File" : "Blob";
    if (isDate(value))
      return "Date";
    if (isTemporalInstant(value))
      return "Instant";
    if (isTemporalPlainDate(value))
      return "PlainDate";
    if (isTemporalPlainDateTime(value))
      return "PlainDateTime";
    if (isTemporalZonedDateTime(value))
      return "ZonedDateTime";
  }
  return t;
}

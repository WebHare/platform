import type { Money } from "./money";
import { isBlob, isDate, isMoney, isTemporalInstant, isTemporalPlainDate, isTemporalPlainDateTime, isTemporalZonedDateTime } from "./quacks";
import type { Temporal } from "temporal-polyfill";

type CamelCase<S extends string> = S extends `${infer P1}_${infer P2}${infer P3}`
  ? `${Lowercase<P1>}${Uppercase<P2>}${CamelCase<P3>}`
  : Lowercase<S>;

type KeysToCamelCase<T> = {
  [K in keyof T as CamelCase<string & K>]: ToCamelCase<T[K]>;
};

type CamelToSnakeCase<S extends string> = S extends `${infer T}${infer U}` ?
  `${T extends Capitalize<T> ? "_" : ""}${Lowercase<T>}${CamelToSnakeCase<U>}` :
  S;

type KeysToSnakeCase<T> = {
  [K in keyof T as CamelToSnakeCase<string & K>]: ToSnakeCase<T[K]>
};

type NonRecordTypes = Date | Money | Blob | Temporal.Instant | Temporal.PlainDate | Temporal.PlainDateTime | Temporal.ZonedDateTime;

export type ToSnakeCase<T> =
  T extends unknown[] ? Array<ToSnakeCase<T[number]>> :
  T extends NonRecordTypes ? T :
  T extends object ? KeysToSnakeCase<T> :
  T;

export type ToCamelCase<T> =
  T extends unknown[] ? Array<ToCamelCase<T[number]>> :
  T extends NonRecordTypes ? T :
  T extends object ? KeysToCamelCase<T> :
  T;

/** Convert a snake_case_name to its corresponding camelCaseName
 * @param name - Name to convert
 * @returns Converted name
*/
export function nameToCamelCase(name: string) {
  return name.replaceAll(/_[a-z]/g, c => c[1].toUpperCase());
}

/** Convert a camelCaseName to corresponding snake_case_name
 * @param name - Name to convert
 * @returns Converted name
*/
export function nameToSnakeCase(name: string) {
  return name.replaceAll(/[A-Z]/g, c => '_' + c.toLowerCase());
}

/// Should we rewrite the key/values in this object?
function recodeObject(inp: object) {
  return !isDate(inp) && !isMoney(inp) && !isBlob(inp) && !isTemporalInstant(inp) && !isTemporalPlainDate(inp) && !isTemporalPlainDateTime(inp) && !isTemporalZonedDateTime(inp);
}

/** Convert all keys to camel case recursively
 * @param inp - Array or object to convert
 * @returns Converted object
*/
export function toSnakeCase<T>(inp: T): ToSnakeCase<T> {
  if (Array.isArray(inp))
    return inp.map(toSnakeCase) as ToSnakeCase<T>;
  if (inp && typeof inp === "object" && recodeObject(inp))
    return Object.fromEntries(Object.entries(inp).map(([key, value]) => [nameToSnakeCase(key), toSnakeCase(value)])) as ToSnakeCase<T>;
  return inp as ToSnakeCase<T>;
}

/** Convert all keys to snake case recursively
 * @param inp - Array or object to convert
 * @returns Converted object
*/
export function toCamelCase<T>(inp: T): ToCamelCase<T> {
  if (Array.isArray(inp))
    return inp.map(toCamelCase) as ToCamelCase<T>;
  if (inp && typeof inp === "object" && recodeObject(inp))
    return Object.fromEntries(Object.entries(inp).map(([key, value]) => [nameToCamelCase(key), toCamelCase(value)])) as ToCamelCase<T>;
  return inp as ToCamelCase<T>;
}

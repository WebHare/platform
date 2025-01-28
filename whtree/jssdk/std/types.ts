import type { Money } from "./money";
import { isBlob, isDate, isMoney } from "./quacks";

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

export type ToSnakeCase<T> =
  T extends unknown[] ? Array<ToSnakeCase<T[number]>> :
  T extends Date | Money | Blob ? T :
  T extends object ? KeysToSnakeCase<T> :
  T;

export type ToCamelCase<T> =
  T extends unknown[] ? Array<ToCamelCase<T[number]>> :
  T extends Date | Money | Blob ? T :
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

/** Convert all keys to camel case recursively
 * @param inp - Array or object to convert
 * @returns Converted object
*/
export function toSnakeCase<T>(inp: T): ToSnakeCase<T> {
  if (Array.isArray(inp))
    return inp.map(toSnakeCase) as ToSnakeCase<T>;
  if (inp && typeof inp === "object" && !isDate(inp) && !isMoney(inp) && !isBlob(inp))
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
  if (inp && typeof inp === "object" && !isDate(inp) && !isMoney(inp) && !isBlob(inp))
    return Object.fromEntries(Object.entries(inp).map(([key, value]) => [nameToCamelCase(key), toCamelCase(value)])) as ToCamelCase<T>;
  return inp as ToCamelCase<T>;
}

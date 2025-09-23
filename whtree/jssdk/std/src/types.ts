import { Money } from "./money";
import { isBlob, isDate, isMoney, isTemporalInstant, isTemporalPlainDate, isTemporalPlainDateTime, isTemporalZonedDateTime, stdTypeOf } from "./quacks";
import type { Temporal } from "temporal-polyfill";

/// Returns T or a promise resolving to T
export type MaybePromise<T> = Promise<T> | T;

export type ComparableType = number | null | bigint | string | Date | Money | boolean | Uint8Array;

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

function recursiveToSnakeCase<T>(inp: T): ToSnakeCase<T> {
  if (Array.isArray(inp))
    return inp.map(toSnakeCase) as ToSnakeCase<T>;
  if (inp && typeof inp === "object" && recodeObject(inp))
    return Object.fromEntries(Object.entries(inp).map(([key, value]) => [nameToSnakeCase(key), recursiveToSnakeCase(value)])) as ToSnakeCase<T>;
  return inp as ToSnakeCase<T>;
}

function recursiveToCamelCase<T>(inp: T): ToCamelCase<T> {
  if (Array.isArray(inp))
    return inp.map(toCamelCase) as ToCamelCase<T>;
  if (inp && typeof inp === "object" && recodeObject(inp))
    return Object.fromEntries(Object.entries(inp).map(([key, value]) => [nameToCamelCase(key), recursiveToCamelCase(value)])) as ToCamelCase<T>;
  return inp as ToCamelCase<T>;
}

/** Convert all keys to camel case recursively
 * @param inp - Array or object to convert
 * @returns Converted object
*/
export function toSnakeCase<T extends object | object[] | null>(inp: T): ToSnakeCase<T> {
  return recursiveToSnakeCase(inp);
}

/** Convert all keys to snake case recursively
 * @param inp - Array or object to convert
 * @returns Converted object
*/
export function toCamelCase<T extends object | object[] | null>(inp: T): ToCamelCase<T> {
  return recursiveToCamelCase(inp);
}

// TODO make this a quack if we're sure Uint8array is what we want to support - this is here basically to give Buffer support to be compatible with hscompat' compare
function isUInt8Array(value: unknown): value is Uint8Array {
  return value !== null && typeof value === "object" && "length" in value && (value as Uint8Array).BYTES_PER_ELEMENT === 1;
}

/** Compare two values of std-supported types
 * @param left - First value
 * @param right - Second value
 * @returns -1 if left \< right, 0 if equal, 1 if left \> right
 */
export function compare(left: ComparableType, right: ComparableType): -1 | 0 | 1 {
  if (left === null)
    return right === null ? 0 : -1;
  else if (right === null)
    return 1;

  switch (typeof left) {
    case "boolean": {
      if (typeof right === "boolean")
        return left !== right ? left < right ? -1 : 1 : 0;
    } break;
    case "number": {
      switch (typeof right) {
        case "bigint": {
          const right_number = Number(right);
          return left !== right_number ? left < right_number ? -1 : 1 : 0;
        }
        case "number": {
          return left !== right ? left < right ? -1 : 1 : 0;
        }
        case "object": {
          if (Money.isMoney(right))
            return Money.cmp(left.toString(), right);
        }
      }
    } break;
    case "bigint": {
      switch (typeof right) {
        case "bigint": {
          return left !== right ? left < right ? -1 : 1 : 0;
        }
        case "number": {
          const left_number = Number(left);
          return left_number !== right ? left_number < right ? -1 : 1 : 0;
        }
        case "object": {
          if (Money.isMoney(right)) {
            return Money.cmp(left.toString(), right);
          }
        }
      }
    } break;
    case "string": {
      if (typeof right === "string")
        return left === right ? 0 : left < right ? -1 : 1;
    } break;
    case "object": {
      if (Money.isMoney(left)) {
        switch (typeof right) {
          case "number":
          case "bigint":
            return Money.cmp(left, right.toString());
          case "object": {
            if (right === null) {
              return 1;
            } else if (Money.isMoney(right))
              return Money.cmp(left, right);
          }
        }
      } else if (isDate(left) && isDate(right)) {
        const left_value = Number(left);
        const right_value = Number(right);
        return left_value !== right_value ? left_value < right_value ? -1 : 1 : 0;
      } else if (isUInt8Array(left) && isUInt8Array(right)) {
        const compareLength = Math.min(left.length, right.length);
        for (let i = 0; i < compareLength; i++) {
          if (left[i] !== right[i])
            return left[i] < right[i] ? -1 : 1;
        }
        return left.length !== right.length ? left.length < right.length ? -1 : 1 : 0;
      }
    } break;
  }
  throw new Error(`Cannot compare a ${stdTypeOf(left)} with a ${stdTypeOf(right)}`);
}

/** Returns all property keys of an object type whose value is comparable */
type ComparableFields<E extends object, K extends keyof E = keyof E> = K extends keyof E ? E[K] extends ComparableType ? K : never : never;

/** Type of array elements for keys in `compareProperties` */
type ComparePropertiesArrayElement<E extends object> = ComparableFields<E> | [ComparableFields<E>, "asc" | "desc"];

/** All possible types of object keys */
type AnyKey = string | symbol | number;

/** Extracts the property name from an array element of CompareProperties */
type GetPropertyFromComparePropertiesArrayElement<T> = T extends AnyKey ? T : T extends [infer A, "asc" | "desc"] ? A : never;

/** Get the list of properties referenced in the `compareProperties` keys list */
type GetPropertiesFromComparePropertiesKeys<K extends AnyKey | Array<AnyKey | [AnyKey, "asc" | "desc"]>> = K extends AnyKey ? K : K extends Array<infer T> ? GetPropertyFromComparePropertiesArrayElement<T> : never;

/** Get all proper prefixes of a tuple, excluding the empty tuple and the source tuple */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TuplePrefixes<K extends AnyKey | [...any[]]> = K extends [any] ? never : K extends [infer A, ...infer B] ? [A] | [A, ...TuplePrefixes<B>] : never;

/** Template for possible keys value (needed to make TS understand that a tuple prefix of the keys is also a valid keys list */
type PossibleFields<E extends object> = ComparableFields<E> | [ComparePropertiesArrayElement<E>, ...Array<ComparePropertiesArrayElement<E>>];


export function compareProperties<const K extends ComparableFields<E> | [...Array<ComparePropertiesArrayElement<E>>], E extends object = Record<GetPropertiesFromComparePropertiesKeys<K>, ComparableType>>(fields: K) {
  const compareList = (Array.isArray(fields) ? fields : [fields]).map((field): [keyof E, 1 | -1] => Array.isArray(field) ? [field[0], field[1] === "desc" ? -1 : 1] : [field, 1]);
  const retval: (lhs: E, rhs: E) => number = (a, b) => {
    for (const [field, negate] of compareList) {
      if (a[field] === undefined || b[field] === undefined)
        throw new Error(`Property '${String(field)}' does not exist`);
      const res = negate * compare(a[field] as ComparableType, b[field] as ComparableType);
      if (res)
        return res;
    }
    return 0;
  };
  return Object.assign(retval, {
    partialCompare: <T extends TuplePrefixes<K> & PossibleFields<E>>(partialFields: T) => compareProperties<T, E>(partialFields)
  });
}

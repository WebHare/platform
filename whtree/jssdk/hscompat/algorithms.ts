import { Money } from "@webhare/std";
import { isDate, determineType, VariableType } from "@mod-system/js/internal/whmanager/hsmarshalling";
import { defaultDateTime } from "./datetime";

export type ComparableType = number | null | bigint | string | Date | Money | boolean;

// needed for interface definitions, don't want to sprinkle the file with eslint-disables or disable globally

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
// eslint-disable-next-line @typescript-eslint/ban-types
type UnknownNonNullish = {};

/* Explanation for the signature of the recordLowerBound family:
   T: all keys mentioned in k should be required and of type ComparableType. If the keys can't be determined
     (because T is any and S is any, or because if invalid values in the k array), just allow any value.
   S: all keys mentioned in K should be required, should exist and T and be of the same type as the
      corresponding property in T. If the keys can't be determined (because T is any and S is any,
      or because of invalid values in the k array), just allow any value. Also done so errors in the
      k array are flagged first, instead of giving an error in s.
   K: Try to use the keys of T. If T is any, fallback to the keys of S. If the keys of both are unknown,
      we'll all any key.
*/

export function recordLowerBound<
  T extends (string extends K ? Any : { [P in K]: ComparableType }),
  S extends (string extends K ? Any : Pick<T, K & keyof T>),
  K extends (UnknownNonNullish extends T ? keyof S : string extends keyof T ? keyof S : keyof T)
>(searchin: readonly T[], searchrecord: Readonly<S | T>, keys: K[]): { found: boolean; position: number } {
  return binaryRecordSearchImpl(searchin, searchrecord, keys, false);
}

export function recordUpperBound<
  T extends (string extends K ? Any : { [P in K]: ComparableType }),
  S extends (string extends K ? Any : Pick<T, K & keyof T>),
  K extends (UnknownNonNullish extends T ? keyof S : string extends keyof T ? keyof S : keyof T)
>(searchin: readonly T[], searchrecord: Readonly<S | T>, keys: K[]): number {
  return binaryRecordSearchImpl(searchin, searchrecord, keys, true).position;
}

export function recordRange<
  T extends (string extends K ? Any : { [P in K]: ComparableType }),
  S extends (string extends K ? Any : Pick<T, K & keyof T>),
  K extends (UnknownNonNullish extends T ? keyof S : string extends keyof T ? keyof S : keyof T)
>(searchin: readonly T[], searchrecord: Readonly<S | T>, keys: K[]): T[] {
  const start = recordLowerBound(searchin, searchrecord, keys);
  const limit = recordUpperBound(searchin, searchrecord, keys);
  return searchin.slice(start.position, limit);
}

function binaryRecordSearchImpl<
  T extends (string extends K ? Any : { [P in K]: ComparableType }),
  S extends (string extends K ? Any : Pick<T, K & keyof T>),
  K extends (UnknownNonNullish extends T ? keyof S : string extends keyof T ? keyof S : keyof T)
>(searchin: readonly T[], searchrecord: Readonly<S | T>, keys: K[], upper_bound: boolean): { found: boolean; position: number } {

  let first = 0;
  let len = searchin.length;
  let found = false;

  const cmpbound = upper_bound ? 1 : 0;
  let unsorted_cmp = 0; // if this is non-0 and cmp is this value, we have an unsorted list
  while (len > 0) {
    const half = Math.floor(len / 2);
    const middle = first + half;
    const cmp = groupCompare(searchin[middle], searchrecord, keys, middle);
    if (cmp == 0) {
      found = true;
      unsorted_cmp = upper_bound ? -1 : 1;
    } else if (cmp == unsorted_cmp)
      throw new Error(`The provided array was not properly sorted!`);

    if (cmp < cmpbound) {
      first = middle + 1;
      len -= half;
      --len;
    } else {
      len = half;
    }
  }
  return { found, position: first };
}

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
      }
    } break;
  }
  throw new Error(`Cannot compare a ${VariableType[determineType(left)]} with a ${VariableType[determineType(right)]}`);
}

function groupCompare<
  T extends (string extends K ? Any : { [P in K]: ComparableType }),
  S extends (string extends K ? Any : Pick<T, K & keyof T>),
  K extends (UnknownNonNullish extends T ? keyof S : string extends keyof T ? keyof S : keyof T)
>(searchin: Readonly<T>, searchrecord: Readonly<S | T>, keys: Array<K & keyof T>, idx: number) {
  for (const key of keys) {
    const searchinvalue = searchin[key];
    const searchrecordvalue = searchrecord[key];
    if (searchinvalue === undefined)
      throw new Error(`Missing key ${JSON.stringify(key)} in array[${idx}]`);
    if (searchrecordvalue === undefined)
      throw new Error(`Missing key ${JSON.stringify(key)} in search record`);

    const cmp = compare(searchin[key], searchrecord[key]);
    if (cmp)
      return cmp;
  }
  return 0;
}

type PartialNoNull<T extends object, K extends keyof T> = {
  [Key in K as T[Key] extends null ? never : Key]?: Exclude<T[Key], null>;
};

function isHareScriptDefaultValue(value: unknown) {
  if (value === false || value === null || value === undefined || value === 0 || value === "" || value === 0n)
    return true;
  if (Array.isArray(value) && !value.length)
    return true;
  if (Money.isMoney(value) && Money.cmp(value, "0") === 0)
    return true;
  if (isDate(value) && value.getTime() <= defaultDateTime.getTime())
    return true;
  if (typeof value === "object" && "length" in value && !value.length)
    return true;
  return false;
}

export function omitHareScriptDefaultValues<T extends object, K extends keyof T>(value: T, keys: K[]): Omit<T, K> & PartialNoNull<T, K>;
export function omitHareScriptDefaultValues<T extends object, K extends keyof T>(value: T[], keys: K[]): Array<Omit<T, K> & PartialNoNull<T, K>>;

export function omitHareScriptDefaultValues<T extends object, K extends keyof T>(value: T | T[], keys: K[]): Omit<T, K> & PartialNoNull<T, K> | Array<Omit<T, K> & PartialNoNull<T, K>> {
  if (Array.isArray(value)) {
    return value.map(e => omitHareScriptDefaultValues(e, keys));
  }

  const res = {} as Record<string, unknown>;
  for (const [key, keyvalue] of Object.entries(value))
    if (!keys.includes(key as K) || !isHareScriptDefaultValue(keyvalue))
      res[key] = keyvalue;
  return res as Omit<T, K> & PartialNoNull<T, K>;
}

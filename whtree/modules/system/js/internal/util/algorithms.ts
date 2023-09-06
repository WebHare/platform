export { pick, omit } from "@webhare/std";

/** Maps every key of an object with a mapping function to a new value
    @typeParam T - Type of the object to map
    @typeParam K - Type of the mapped value
    @param obj - Object to map
    @param mapping - Mapping function
    @returns Mapped object
*/
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapObject<T extends object, N extends (v: T[keyof T], k?: keyof T) => any>(obj: T, mapping: N): { [K in keyof T]: ReturnType<N> } {
  /* Typescript doesn't support higher-order type arguments at the moment, this is the best we can do for now. If N is
     made generic (like <S>(a:s) => dependent type) you will probably get 'unknown' as type determined for S.
  */
  const retval = {} as { [K in keyof T]: ReturnType<N> };
  for (const i in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, i)) {
      retval[i] = mapping(obj[i], i);
    }
  }
  return retval;
}

/** Recursively freezes a value
 * @param value - Value to freeze
 */
export function freezeRecursive<T>(value: T): RecursiveReadOnly<T> {
  if (Array.isArray(value)) {
    Object.freeze(value);
    for (const elt of value)
      freezeRecursive(elt);
  } else if (typeof value === "object" && value) {
    Object.freeze(value);
    for (const v of Object.values(value))
      freezeRecursive(v);
  }
  return value as RecursiveReadOnly<T>;
}

/** Recursively converts a type to readonly
 * @typeParam T - Type to convert
*/
export type RecursiveReadOnly<T> = T extends Array<infer U> ? ReadonlyArray<RecursiveReadOnly<U>> : T extends object ? { readonly [K in keyof T]: RecursiveReadOnly<T[K]> } : T;

/** Recursively apply `Partial<>`  on records in a type
 * @typeParam T - Type to convert
*/
export type RecursivePartial<T> = T extends Array<infer U> ? Array<RecursivePartial<U>> : T extends object ? { [K in keyof T]?: RecursivePartial<T[K]> } : T;

/** Returns (and Typescript-asserts) that the specified function is truthy. Handy for adjusting the type of a map when
 * filtering out falsy values
 * @example
 * const myarray: Array&lt;number | null&gt; = [0, null];
 * const filtered: number[] = myarray.filter(isTruthy);
 **/
// eslint-disable-next-line @typescript-eslint/ban-types
export function isTruthy<T>(a: T): a is (T & {}) {
  return Boolean(a);
}

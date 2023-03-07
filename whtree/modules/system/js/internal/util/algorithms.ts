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

/** Returns an object with a selection of properties
    @typeParam T - Type of the supplied object
    @typeParam K - Type of the property keys to return
    @param obj - Object to pick properties out of
    @param keys - Names of the properties to pick
    @returns Resulting object
*/
export function pick<T extends object, K extends string & keyof T>(obj: T, keys: readonly K[]): Pick<T, K>;

/** Returns an array with a selection of properties
    @typeParam T - Type of the supplied array
    @typeParam K - Type of the property keys to return
    @param obj - Array to pick properties out of
    @param keys - Names of the properties to pick
    @returns Resulting array
*/
export function pick<T extends object, K extends string & keyof T>(arr: T[], keys: readonly K[]): Array<Pick<T, K>>;

export function pick<T extends object, K extends string & keyof T>(value: T | T[], keys: readonly K[]): Pick<T, K> | Array<Pick<T, K>> {
  if (Array.isArray(value))
    return value.map((elt: T) => pick(elt, keys));
  const ret = {} as Pick<T, K>;
  keys.forEach((key: K) => {
    if (key in value)
      ret[key] = value[key];
  });
  return ret;
}

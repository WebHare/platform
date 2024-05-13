export interface EmplaceHandler<ValueType> {
  insert?: () => ValueType;
  update?: (current: ValueType) => ValueType;
}

//emplace is based on https://github.com/tc39/proposal-upsert (a Map.prototype.emplace)
/** Place a value into a Map
 * @param map - The map to place the value into
 * @param key - The key to add/replace
 * @param handler - Callbacks for inserting or updating the value
 * @returns The value that was placed into the map.
 * @throws If the key is not found and no insert handler is provided
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Cannot specify this without using any
export function emplace<T extends Map<any, any>>(map: T, key: T extends Map<infer K, any> ? K : never, handler?: T extends Map<any, infer V> ? EmplaceHandler<V> : never): T extends Map<any, infer V> ? V : never {
  let current = map.get(key);
  if (current !== undefined) {
    if (handler?.update) {
      current = handler.update(current);
      map.set(key, current);
    }
    return current;
  }

  if (!handler?.insert)
    throw new Error("Key not found and no insert handler provided");

  const setvalue = handler.insert();
  map.set(key, setvalue);
  return setvalue;
}

/** Returns an object with a selection of properties
    @typeParam T - Type of the supplied object
    @typeParam K - Type of the property keys to return
    @param obj - Object to pick properties out of
    @param keys - Names of the properties to pick
    @returns Resulting object
*/
export function pick<T extends object, K extends string & NoInfer<keyof T>>(obj: T, keys: readonly K[]): Pick<T, K>;

/** Returns an array with a selection of properties
    @typeParam T - Type of the supplied array
    @typeParam K - Type of the property keys to return
    @param obj - Array to pick properties out of
    @param keys - Names of the properties to pick
    @returns Resulting array
*/
export function pick<T extends object, K extends string & NoInfer<keyof T>>(arr: T[], keys: readonly K[]): Array<Pick<T, K>>;

export function pick<T extends object, K extends string & NoInfer<keyof T>>(value: T | T[], keys: readonly K[]): Pick<T, K> | Array<Pick<T, K>> {
  if (Array.isArray(value))
    return value.map((elt: T) => pick(elt, keys));
  const ret = {} as Pick<T, K>;
  keys.forEach((key: K) => {
    if (key in value)
      ret[key] = value[key];
  });
  return ret;
}

/** Returns an object with a selection of properties left out
    @typeParam T - Type of the supplied object
    @typeParam K - Type of the property keys to leave out
    @param obj - Object to leave properties out of
    @param keys - Names of the properties to remove
    @returns Resulting object
*/
export function omit<T extends object, K extends string & NoInfer<keyof T>>(obj: T, keys: readonly K[]): Omit<T, K>;

/** Returns an array with a selection of properties left out
    @typeParam T - Type of the supplied array
    @typeParam K - Type of the property keys to leave out
    @param obj - Array to leave properties out of
    @param keys - Names of the properties to leave out
    @returns Resulting array
*/
export function omit<T extends object, K extends string & NoInfer<keyof T>>(arr: T[], keys: readonly K[]): Array<Omit<T, K>>;

export function omit<T extends object, K extends string & NoInfer<keyof T>>(value: T | T[], keys: readonly K[]): Omit<T, K> | Array<Omit<T, K>> {
  if (Array.isArray(value))
    return value.map((elt: T) => omit(elt, keys));
  const ret = {} as Omit<T, K>;
  for (const [key, val] of Object.entries(value)) {
    if (!keys.includes(key as K))
      ret[key as Exclude<keyof T, K>] = val;
  }
  return ret;
}

/** Shuffle an array in-place
 * @param array - Array to shuffle
 * @returns The shuffled array
*/
export function shuffle<T>(array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/** Returns (and TypeScript-asserts) that the specified function is truthy. Handy for adjusting the type of an array when
 * filtering out falsy values
 * @example
 * const myarray: Array&lt;number | null&gt; = [0, null];
 * const filtered: number[] = myarray.filter(isTruthy);
 **/
// eslint-disable-next-line @typescript-eslint/ban-types
export function isTruthy<T>(a: T): a is (T & {}) {
  return Boolean(a);
}

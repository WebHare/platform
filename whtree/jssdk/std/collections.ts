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

/** Group items into a map (implementation of proposed Map.groupBy)
 * @param items - Items to group
 * @param callbackfn - Function that calculates the key of an item
 * @returns - Map from a key to the list of items that generated that key
 * @see https://github.com/tc39/proposal-array-grouping/
 */
export function mapGroupBy<Item, Key>(items: Iterable<Item>, callbackfn: (item: Item, idx: number) => Key): Map<Key, Item[]> {
  const retval = new Map<Key, Item[]>;
  let idx = 0;
  for (const item of items) {
    const key = callbackfn(item, idx++);
    let list = retval.get(key);
    if (!list)
      retval.set(key, list = []);
    list.push(item);
  }
  return retval;
}

/** Group items into a record (implementation of proposed Object.groupBy)
 * @param items - Items to group
 * @param callbackfn - Function that calculates the key of an item
 * @returns - Object that maps from a key to the list of items that generated that key
 * @see https://github.com/tc39/proposal-array-grouping/
 */
export function objectGroupBy<Item, Key extends string | number | symbol>(items: Iterable<Item>, callbackfn: (item: Item, idx: number) => Key): Record<Key, Item[]> {
  return Object.fromEntries(mapGroupBy(items, callbackfn).entries()) as Record<Key, Item[]>;
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

/** Returns an object with a selection of properties left out
    @typeParam T - Type of the supplied object
    @typeParam K - Type of the property keys to leave out
    @param obj - Object to leave properties out of
    @param keys - Names of the properties to remove
    @returns Resulting object
*/
export function omit<T extends object, K extends string & keyof T>(obj: T, keys: readonly K[]): Omit<T, K>;

/** Returns an array with a selection of properties left out
    @typeParam T - Type of the supplied array
    @typeParam K - Type of the property keys to leave out
    @param obj - Array to leave properties out of
    @param keys - Names of the properties to leave out
    @returns Resulting array
*/
export function omit<T extends object, K extends string & keyof T>(arr: T[], keys: readonly K[]): Array<Omit<T, K>>;

export function omit<T extends object, K extends string & keyof T>(value: T | T[], keys: readonly K[]): Omit<T, K> | Array<Omit<T, K>> {
  if (Array.isArray(value))
    return value.map((elt: T) => omit(elt, keys));
  const ret = {} as Omit<T, K>;
  for (const [key, val] of Object.entries(value)) {
    if (!keys.includes(key as K))
      ret[key as Exclude<keyof T, K>] = val;
  }
  return ret;
}

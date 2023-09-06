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

/* eslint-disable @typescript-eslint/no-explicit-any -- Cannot specify this without using any */

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
export function emplace<T extends Map<any, any> | WeakMap<any, any>>(
  map: T,
  key: T extends Map<infer K, any> ? K : T extends WeakMap<infer K, any> ? K : never,
  handler?: T extends Map<any, infer V> ? EmplaceHandler<V> : T extends WeakMap<any, infer V> ? EmplaceHandler<V> : never):
  T extends Map<any, infer V> ? V : T extends WeakMap<any, infer V> ? V : never {
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

// the `| keyof X` is needed to be able to use a `keyof X` type as key parameter in DistributedPick or DistributedOmit in generics
export type DistributedKeys<X extends object> = (X extends object ? keyof X : never) | keyof X;

/** Applies Pick to all types in a union. Allows all keys that are present in any object in the union. Warning: You might not be
    able to use all keys of the union if TypeScript has narrowed the union to a specific type. Eg:
```typescript
type A = { x: number; t: "a"; a: number } | { x: number; t: "b"; b: number };
const a: A = { t: "a", a: 1 };
const b = pick(a, ["t", "a", "b"]); // No overload matches this call. <snip> Type '"b"' is not assignable to type '"a" | "t" | "d"'.
```
    @typeParam T - Type of the supplied object
    @typeParam K - Type of the property keys to return
    @returns Type with only the specified keys (distributed over the union if present)
*/
export type DistributedPick<X extends object, Y extends DistributedKeys<X>> = X extends object ? Pick<X, keyof X & Y> : never;

/** Applies Omit to all types in a union. Allows all keys that are not present in any object in the union. Warning: You might not be
    able to use all keys of the union if TypeScript has narrowed the union to a specific type. Eg:
```typescript
type A = { x: number; t: "a"; a: number } | { x: number; t: "b"; b: number };
const a: A = { t: "a", a: 1 };
const b = omit(a, ["b"]); // No overload matches this call. <snip> Type '"b"' is not assignable to type '"a" | "t" | "d"'.
```
    @typeParam T - Type of the supplied object
    @typeParam K - Type of the property keys to leave out
    @returns Type with only the specified keys left out (distributed over the union if present)
*/
export type DistributedOmit<X extends object, Y extends DistributedKeys<X>> = X extends object ? Omit<X, keyof X & Y> : never;

/** Returns an object with a selection of properties
    @typeParam T - Type of the supplied object
    @typeParam K - Type of the property keys to return
    @param obj - Object to pick properties out of
    @param keys - Names of the properties to pick
    @returns Resulting object
*/
export function pick<T extends object, K extends string & NoInfer<DistributedKeys<T>>>(obj: T, keys: readonly K[]): DistributedPick<T, K>;

/** Returns an array with a selection of properties
    @typeParam T - Type of the supplied array
    @typeParam K - Type of the property keys to return
    @param obj - Array to pick properties out of
    @param keys - Names of the properties to pick
    @returns Resulting array
*/
export function pick<T extends object, K extends string & NoInfer<DistributedKeys<T>>>(arr: T[], keys: readonly K[]): Array<DistributedPick<T, K>>;

export function pick<T extends object, K extends string & NoInfer<DistributedKeys<T>>>(value: T | T[], keys: readonly K[]): DistributedPick<T, K> | Array<DistributedPick<T, K>> {
  if (Array.isArray(value))
    return value.map((elt: T) => pick(elt, keys));
  const ret = {} as T;
  keys.forEach((key: K) => {
    if (key in value)
      ret[key] = value[key];
  });
  return ret as object as DistributedPick<T, K>;
}

/** Returns an object with a selection of properties left out
    @typeParam T - Type of the supplied object
    @typeParam K - Type of the property keys to leave out
    @param obj - Object to leave properties out of
    @param keys - Names of the properties to remove
    @returns Resulting object
*/
export function omit<T extends object, K extends string & NoInfer<DistributedKeys<T>>>(obj: T, keys: readonly K[]): DistributedOmit<T, K>;

/** Returns an array with a selection of properties left out
    @typeParam T - Type of the supplied array
    @typeParam K - Type of the property keys to leave out
    @param obj - Array to leave properties out of
    @param keys - Names of the properties to leave out
    @returns Resulting array
*/
export function omit<T extends object, K extends string & NoInfer<DistributedKeys<T>>>(arr: T[], keys: readonly K[]): Array<DistributedOmit<T, K>>;

export function omit<T extends object, K extends string & NoInfer<DistributedKeys<T>>>(value: T | T[], keys: readonly K[]): DistributedOmit<T, K> | Array<DistributedOmit<T, K>> {
  if (Array.isArray(value))
    return value.map((elt: T) => omit(elt, keys));
  const ret = {} as T;
  for (const [key, val] of Object.entries(value)) {
    if (!keys.includes(key as K))
      ret[key as K] = val;
  }
  return ret as object as DistributedOmit<T, K>;
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
export function isTruthy<T>(a: T): a is (T & {}) {
  return Boolean(a);
}

/** Append to array, without overflowing the stack (eg V8 overflows at more than 32K entries)
 * @param array - Array to append to
 * @param values - Values to append
*/
export function appendToArray<T extends unknown[]>(array: T, values: readonly unknown[]): void {
  if (values.length < 1000)
    array.push(...values); //push should be safe enough
  else for (const value of values) //performance wise this appears just as fast as tricks with pushing blocks of slices
    array.push(value);

  //not returning the original array to make it clear we're not creating a new one
}

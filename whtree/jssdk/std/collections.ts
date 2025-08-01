/* eslint-disable @typescript-eslint/no-explicit-any -- Cannot specify this without using any */

export interface EmplaceHandler<ValueType> {
  insert?: () => ValueType;
  update?: (current: ValueType) => ValueType;
}

function binarySearchImpl<A, K>(compareFn: (element: A, key: K) => number, contents: A[], searchfor: K, upper_bound: boolean): { present: boolean; index: number } {
  let first = 0;
  let len = contents.length;
  let present = false;

  const cmpbound = upper_bound ? 1 : 0;
  let unsorted_cmp = 0; // if this is non-0 and cmp is this value, we have an unsorted list
  while (len > 0) {
    const half = Math.floor(len / 2);
    const middle = first + half;
    const cmp = compareFn(contents[middle], searchfor);
    if (cmp === 0) {
      present = true;
      unsorted_cmp = upper_bound ? -1 : 1;
    } else if (cmp === unsorted_cmp)
      throw new Error(`The provided array was not properly sorted!`);

    if (cmp < cmpbound) {
      first = middle + 1;
      len -= half;
      --len;
    } else {
      len = half;
    }
  }
  return { present, index: first };
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
    @param arr - Array to pick properties out of
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
    @param arr - Array to leave properties out of
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
export function appendToArray<T>(array: T[], values: ReadonlyArray<NoInfer<T>>): void {
  if (values.length < 1000)
    array.push(...values); //push should be safe enough
  else for (const value of values) //performance wise this appears just as fast as tricks with pushing blocks of slices
    array.push(value);

  //not returning the original array to make it clear we're not creating a new one
}

type TypedEntriesInternal<T extends object, K extends keyof T> = K extends keyof T ? [K, T[K]] : never;

/** Returns a union of [ key, value ] types for an object */
export type TypedEntries<T extends object> = T extends object ? TypedEntriesInternal<T, keyof T & string> : never;

/** Returns an array of key/values of the enumerable own properties of an object, with exact types. Use when
 * no extra properties are expected on the object. Exists because Object.entries returns always string as key type.
 * @param obj - Object that contains the properties and methods
 */
export function typedEntries<T extends object>(obj: T): Array<TypedEntries<T>> {
  return Object.entries(obj) as Array<TypedEntries<T>>;
}

/** Returns an array of keys of the enumerable own properties of an object, with exact types. Use when
 * no extra properties are expected on the object. Exists because Object.keys returns always string as key type.
 * @param obj - Object that contains the properties and methods
 */
export function typedKeys<T extends object>(obj: T): Array<keyof T & string> {
  return Object.keys(obj) as Array<keyof T & string>;
}

/** Given a union of [key, value] types, returns the object constructed from those pairs. Exists because
 *  Object.fromEntries does not take the type of the keys and values into account.
 * @typeParam T - Union of [key, value] pairs
 */
export type TypedFromEntries<T extends [string, unknown]> = { [C in T as C[0]]: C[1] };

/** Returns an object from an iterable of [key, value] pairs, with exact types. Exists because Object.fromEntries
 * doesn't take the type of the keys and values into account.
 * @param entries - Iterable of [key, value] pairs
 * @returns An object with the same keys and values as the input
 */
export function typedFromEntries<T extends [string, unknown]>(entries: Iterable<T>): TypedFromEntries<T> {
  return Object.fromEntries(entries) as TypedFromEntries<T>;
}


export class SortedMultiSet<V> {
  private contents: V[] = [];

  constructor(private compareFn: (lhs: V, rhs: V) => number, contents?: V[]) {
    if (contents)
      this.addMultiple(contents);
  }

  get size() {
    return this.contents.length;
  }

  at(index: number): V | undefined {
    return this.contents.at(index);
  }

  add(value: V): number {
    const pos = this.upperBound(value);
    this.contents.splice(pos, 0, value);
    return pos;
  }

  addMultiple(values: V[]): void {
    for (const value of values) {
      this.add(value);
    }
  }

  delete(key: V): void {
    const [start, limit] = this.range(key);
    this.contents.splice(start, limit - start);
  }

  clear() {
    this.contents.splice(0, this.contents.length);
  }

  lowerBound(key: Readonly<V>): { present: boolean; index: number } {
    return binarySearchImpl(this.compareFn, this.contents, key, false);
  }

  upperBound(key: Readonly<V>): number {
    return binarySearchImpl(this.compareFn, this.contents, key, true).index;
  }

  range(key: Readonly<V>): [number, number] {
    return [this.lowerBound(key).index, this.upperBound(key)];
  }

  slice(start: number, limit: number): V[] {
    return this.contents.slice(start, limit);
  }

  *#sliceIterator(start: number, limit: number): Generator<V, void> {
    for (let idx = start; idx < limit; ++idx)
      yield this.contents[idx];
  }

  sliceRange(key: Readonly<V>): V[] {
    const [start, limit] = this.range(key);
    return this.slice(start, limit);
  }

  rangeIterator(key: Readonly<V>): Iterable<V> {
    const [start, limit] = this.range(key);
    return this.#sliceIterator(start, limit);
  }
}

export class SortedMultiMap<K, V> {
  private compareFn;
  private contents: Array<[K, V]> = [];

  constructor(compareFn: (lhs: K, rhs: K) => number, contents?: Array<[K, V]>) {
    this.compareFn = (element: [K, V], key: K) => compareFn(element[0], key);
    if (contents)
      this.addMultiple(contents);
  }

  get size() {
    return this.contents.length;
  }

  at(index: number): [K, V] | undefined {
    return this.contents.at(index);
  }

  add(key: K, value: V): number {
    const pos = this.upperBound(key);
    this.contents.splice(pos, 0, [key, value]);
    return pos;
  }

  addMultiple(values: Array<[K, V]>) {
    for (const [key, value] of values) {
      this.add(key, value);
    }
  }

  delete(key: K): void {
    const [start, limit] = this.range(key);
    this.contents.splice(start, limit - start);
  }

  clear() {
    this.contents.splice(0, this.contents.length);
  }

  lowerBound(key: Readonly<K>): { present: boolean; index: number } {
    return binarySearchImpl(this.compareFn, this.contents, key, false);
  }

  upperBound(key: Readonly<K>): number {
    return binarySearchImpl(this.compareFn, this.contents, key, true).index;
  }

  range(key: Readonly<K>): [number, number] {
    return [this.lowerBound(key).index, this.upperBound(key)];
  }

  slice(start: number, limit: number): Array<[K, V]> {
    return this.contents.slice(start, limit);
  }

  *#sliceIterator(start: number, limit: number): Generator<[K, V], void> {
    for (let idx = start; idx < limit; ++idx)
      yield this.contents[idx];
  }

  sliceRange(key: Readonly<K>): Array<[K, V]> {
    const [start, limit] = this.range(key);
    return this.slice(start, limit);
  }

  rangeIterator(key: Readonly<K>): Iterable<[K, V]> {
    const [start, limit] = this.range(key);
    return this.#sliceIterator(start, limit);
  }
}

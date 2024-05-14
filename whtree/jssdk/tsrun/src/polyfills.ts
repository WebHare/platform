// Set up dispose symbols - https://github.com/evanw/esbuild/pull/3192 "you'll need to polyfill Symbol.dispose if it's not present before you use it.

//@ts-ignore -- It's marked readonly
Symbol.dispose ||= Symbol.for('Symbol.dispose');
//@ts-ignore -- It's marked readonly
Symbol.asyncDispose ||= Symbol.for('Symbol.asyncDispose');

// Set up promise resolvers (ES2024)
Promise.withResolvers ||= function <T>(): PromiseWithResolvers<T> {
  let resolve: (value: T | PromiseLike<T>) => void;
  let reject: (reason: Error) => void;
  const promise = new Promise<T>((_resolve, _reject) => { resolve = _resolve; reject = _reject; });
  // @ts-ignore `resolve` and `reject` are assigned synchronously, which isn't picked up by the TypeScript compiler (see
  // https://github.com/Microsoft/TypeScript/issues/30053)
  return { promise, resolve, reject };
};

// Polyfills for https://caniuse.com/?search=groupby - needed until we can assume safari 17.4 as global baseline
if (!Map.groupBy)
  Map.groupBy = function <Item, Key>(items: Iterable<Item>, callbackfn: (item: Item, idx: number) => Key): Map<Key, Item[]> {
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
  };

if (!Object.groupBy)
  Object.groupBy = function <Item, Key extends string | number | symbol>(items: Iterable<Item>, callbackfn: (item: Item, idx: number) => Key): Partial<Record<Key, Item[]>> {
    return Object.fromEntries(Map.groupBy(items, callbackfn).entries()) as Partial<Record<Key, Item[]>>;
  };

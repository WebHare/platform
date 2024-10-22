/* eslint-disable @typescript-eslint/array-type */
/* eslint-disable @typescript-eslint/no-loop-func */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-this-alias */

/* Iterator polyfills (https://caniuse.com/?search=iterator) - stage 4 ES but not in all browsers yet
   Based on https://github.com/alkihis/iterator-polyfill/tree/master but we removed all the AsyncIterator
   stuff as that's still stage 2 AND not implemented in TypeScript (as of 5.6)

   We're ignoring a few linting/any issues as we really don't care to maintain this much
   Fixed an issue with .some - reported as https://github.com/alkihis/iterator-polyfill/issues/6
*/

(function () {
  // polyfill already applied / proposal implemented
  if ('Iterator' in globalThis) {
    return;
  }

  // Polyfill for Iterator
  const IteratorPrototype = {};

  const ArrayIteratorPrototype = Object.getPrototypeOf([][Symbol.iterator]());
  const OriginalIteratorPrototype = Object.getPrototypeOf(ArrayIteratorPrototype);

  Object.setPrototypeOf(OriginalIteratorPrototype, IteratorPrototype);

  Object.defineProperties(IteratorPrototype, {
    [Symbol.iterator]: {
      value() {
        return this;
      }
    },
    map: {
      *value<T, R>(callback: (value: T) => R): Generator<any, any, any> {
        const it = this;
        let value = it.next();

        while (!value.done) {
          const real_value = callback(value.value);
          const next_value = yield real_value;
          value = it.next(next_value);
        }

        return value.value;
      },
    },
    filter: {
      *value<T>(callback: (value: T) => boolean): Generator<any, any, any> {
        const it = this;
        let value = it.next();
        let next_value;

        while (!value.done) {
          const real_value = value.value;
          if (callback(real_value)) {
            next_value = yield real_value;
            value = it.next(next_value);
          } else {
            value = it.next(next_value);
          }
        }

        return value.value;
      },
    },
    find: {
      value<T>(callback: (value: boolean) => T) {
        const it = this;
        let value = it.next();

        while (!value.done) {
          const real_value = value.value;

          if (callback(real_value))
            return real_value;

          value = it.next();
        }
      }
    },
    every: {
      value<T>(callback: (value: T) => boolean) {
        const it = this;
        let value = it.next();

        while (!value.done) {
          const real_value = value.value;

          if (!callback(real_value))
            return false;

          value = it.next();
        }

        return true;
      }
    },
    some: {
      value<T>(callback: (value: T) => boolean) {
        const it = this;
        let value = it.next();

        while (!value.done) {
          const real_value = value.value;

          if (callback(real_value)) {
            it.return();
            return true;
          }

          value = it.next();
        }

        return false;
      }
    },
    toArray: {
      value(max_count = Infinity) {
        const values = [];

        const it = this;
        let value = it.next();

        while (!value.done) {
          const real_value = value.value;

          if (max_count <= 0)
            return values;

          values.push(real_value);

          if (max_count !== Infinity)
            max_count--;

          value = it.next();
        }

        return values;
      }
    },
    take: {
      *value(limit: number): Generator<any, any, any> {
        limit = Number(limit);
        if (limit < 0)
          throw new RangeError('Invalid limit.');

        const it = this;
        let value = it.next();
        let remaining = limit;
        let next_value;

        while (!value.done) {
          const real_value = value.value;

          if (remaining <= 0)
            return;

          next_value = yield real_value;
          value = it.next(next_value);
          remaining--;
        }

        return value.value;
      },
    },
    drop: {
      *value(limit: number): Generator<any, any, any> {
        limit = Number(limit);
        if (limit < 0)
          throw new RangeError('Invalid limit.');

        const it = this;
        let value = it.next();
        let remaining = limit;
        let next_value;

        while (!value.done) {
          const real_value = value.value;

          if (remaining > 0) {
            value = it.next(next_value);
            remaining--;
            continue;
          }

          next_value = yield real_value;
          value = it.next(next_value);
        }

        return value.value;
      },
    },
    asIndexedPairs: {
      *value(): Generator<any, any, any> {
        const it = this;
        let value = it.next();
        let index = 0;

        while (!value.done) {
          const real_value = value.value;
          const next_value = yield [index, real_value];
          value = it.next(next_value);
          index++;
        }

        return value.value;
      }
    },
    flatMap: {
      *value<T, R extends object>(mapper: (value: T) => IterableIterator<R> | R): Generator<any, any, any> {
        if (typeof mapper !== 'function') {
          throw new TypeError('Mapper must be a function.');
        }

        const it = this;
        let value = it.next();
        let next_value;

        while (!value.done) {
          const real_value = value.value;
          const mapped = mapper(real_value);

          if (Symbol.iterator in mapped) {
            // @ts-ignore -- copied from original
            next_value = yield* mapped[Symbol.iterator]();
          } else {
            next_value = yield mapped;
          }

          value = it.next(next_value);
        }

        return value.value;
      },
    },
    reduce: {
      value<T, V>(reducer: (acc: V, value: T) => V, initial_value?: V) {
        let acc = initial_value;

        const it = this;
        if (acc === undefined) {
          acc = it.next().value;
        }

        let value = it.next();
        while (!value.done) {
          const real_value = value.value;

          acc = reducer(acc!, real_value);

          value = it.next();
        }

        return acc;
      }
    },
    forEach: {
      value<T>(callback: (value: T) => any) {
        const it = this;
        let value = it.next();

        while (!value.done) {
          const real_value = value.value;

          callback(real_value);

          value = it.next();
        }
      }
    },
    [Symbol.toStringTag]: {
      value: 'IteratorPrototype'
    },

    /* OUTSIDE PROPOSAL */
    count: {
      value() {
        let count = 0;

        const it = this;
        let value = it.next();

        while (!value.done) {
          count++;
          value = it.next();
        }

        return count;
      },
    },
    join: {
      value(string: string) {
        let final = '';
        let first = true;

        const it = this;
        let value = it.next();

        while (!value.done) {
          const real_value = value.value;

          if (first) {
            first = false;
            final += real_value;
          } else {
            final += string + real_value;
          }

          value = it.next();
        }

        return final;
      }
    },
    chain: {
      *value<I>(...iterables: IterableIterator<I>[]) {
        yield* this;

        for (const it of iterables) {
          yield* it;
        }
      }
    },
    zip: {
      *value<T, O>(...others: IterableIterator<O>[]): Iterator<(T | O)[]> {
        const it_array = [this, ...others].map((e: any) => Symbol.iterator in e ? e[Symbol.iterator]() : e as Iterator<T | O>);
        let values = it_array.map(e => e.next());
        let next_value: any;

        while (values.every(e => !e.done)) {
          next_value = yield values.map(e => e.value);
          values = it_array.map(e => e.next(next_value));
        }
      },
    },
    takeWhile: {
      *value<T>(callback: (value: T) => boolean): Generator<any, any, any> {
        const it = this;
        let value = it.next();
        let next_value;

        while (!value.done) {
          const real_value = value.value;

          if (callback(real_value))
            next_value = yield real_value;
          else
            return;

          value = it.next(next_value);
        }

        return value.value;
      }
    },
    dropWhile: {
      *value<T>(callback: (value: T) => boolean): Generator<any, any, any> {
        const it = this;
        let value = it.next();
        let next_value;
        let finished = false;

        while (!value.done) {
          const real_value = value.value;

          if (!finished && callback(real_value)) {
            value = it.next(next_value);
            continue;
          }

          finished = true;
          next_value = yield real_value;

          value = it.next(next_value);
        }

        return value.value;
      }
    },
    fuse: {
      *value(): Generator<any, any, any> {
        const it = this;
        let value = it.next();
        let next_value;

        while (!value.done) {
          const real_value = value.value;

          if (real_value !== undefined && real_value !== null)
            next_value = yield real_value;
          else
            return;

          value = it.next(next_value);
        }

        return value.value;
      }
    },
    partition: {
      value<T>(callback: (value: T) => boolean) {
        const partition1 = [], partition2 = [];

        const it = this;
        let value = it.next();

        while (!value.done) {
          const real_value = value.value;

          if (callback(real_value))
            partition1.push(real_value);
          else
            partition2.push(real_value);

          value = it.next();
        }

        return [partition1, partition2];
      },
    },
    findIndex: {
      value<T>(callback: (value: T) => boolean) {
        const it = this;
        let i = 0;
        let value = it.next();

        while (!value.done) {
          const real_value = value.value;

          if (callback(real_value))
            return i;

          value = it.next();
          i++;
        }

        return -1;
      }
    },
    max: {
      value() {
        let max = -Infinity;

        const it = this;
        let value = it.next();

        while (!value.done) {
          const real_value = value.value;

          if (max < real_value)
            max = real_value;

          value = it.next();
        }

        return max;
      },
    },
    min: {
      value() {
        let min = Infinity;

        const it = this;
        let value = it.next();

        while (!value.done) {
          const real_value = value.value;

          if (min > real_value)
            min = real_value;

          value = it.next();
        }

        return min;
      },
    },
    cycle: {
      *value(): Generator<any, any, any> {
        const values = [];

        const it = this;
        let value = it.next();

        while (!value.done) {
          const real_value = value.value;
          values.push(real_value);

          const next_value = yield real_value;
          value = it.next(next_value);
        }

        while (true) {
          yield* values;
        }
      },
    },
  });

  //iterator.from from https://github.com/rauschma/iterator-helpers-polyfill/

  function isObject(value: unknown) {
    if (value === null) return false;
    const t = typeof value;
    return t === 'object' || t === 'function';
  }

  function GetIteratorFlattenable<T>(obj: Record<symbol, any>): T {
    if (!isObject(obj)) {
      throw new TypeError();
    }
    const method = obj[Symbol.iterator];
    let iterator = undefined;
    if (typeof method !== 'function') {
      iterator = obj;
    } else {
      iterator = method.call(obj);
    }
    if (!isObject(iterator)) {
      throw new TypeError();
    }
    return iterator;
  }

  if (!('Iterator' in globalThis)) {
    const Iterator = function Iterator() { };

    Iterator.prototype = IteratorPrototype;

    // @ts-expect-error We're still missing From in this poyfill
    (globalThis).Iterator = Iterator;
  }


  //----- Static method -----
  // Must be done after Iterator.prototype was set up,
  // so that `extends Iterator` works below

  class WrappedIterator<T, TReturn = any, TNext = undefined> extends Iterator<T, TReturn, TNext> {
    #iterator;
    constructor(iterator: Iterator<T, TReturn, TNext>) {
      super();
      this.#iterator = iterator;
    }
    override next(...args: [] | [TNext]): any {
      return this.#iterator.next(...args);
    }
    // `async` helps with line (*)
    override return(value?: TReturn | PromiseLike<TReturn>): any {
      const returnMethod = this.#iterator.return;
      if (returnMethod === undefined) {
        return { done: true, value: value as any }; // (*)
      }
      return returnMethod.call(this.#iterator);
    }
  }

  function Iterator_from<T>(value: any) {
    const iterator = GetIteratorFlattenable<Iterator<T>>(value);
    if (iterator instanceof Iterator) {
      return iterator;
    }
    // `iterator´ does not support the new API – wrap it so that it does
    return new WrappedIterator(iterator);
  }

  Object.defineProperty(
    Iterator, 'from',
    {
      writable: true,
      enumerable: false,
      configurable: true,
      value: Iterator_from,
    }
  );
})();

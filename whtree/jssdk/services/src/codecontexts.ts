/* Should be implemented usingand use the terminology of https://github.com/tc39/proposal-async-context

   but practically use https://nodejs.org/api/async_context.html#class-asynclocalstorage
*/

import { EmplaceHandler, emplace } from "@webhare/std";
import { AsyncLocalStorage } from "async_hooks";

let contextcounter = 0;

const als = new AsyncLocalStorage<CodeContext>;
const rootstorage = new Map<string | symbol, unknown>;

class WrappedGenerator<G extends Generator<T, TReturn, TNext>, T = unknown, TReturn = unknown, TNext = unknown> implements Generator<T, TReturn, TNext> {
  codecontext;
  generator;

  constructor(codecontext: CodeContext, generator: G) {
    this.codecontext = codecontext;
    this.generator = generator;
  }

  next(...args: [] | [TNext]) {
    return this.codecontext.run(() => this.generator.next(...args));
  }
  return(value: TReturn) {
    return this.codecontext.run(() => this.generator.return(value));
  }
  throw(e: unknown) {
    return this.codecontext.run(() => this.generator.throw(e));
  }
  [Symbol.iterator]() {
    return this;
  }
}

//Note that CodeContext is not intended to be AsyncLocalStorage/AsyncContext but it's a specific instance of an async store

/** Context for running async code.
 */
export class CodeContext {
  readonly id: string;
  readonly storage = new Map<string | symbol, unknown>();

  constructor() {
    this.id = `whcontext-${++contextcounter}`;
  }

  static wrap<R>(callback: (...args: unknown[]) => R): (...args: unknown[]) => R {
    const context = getCodeContext();
    return () => context.run(callback);
  }

  static wrapGenerator<R extends Generator>(callback: (...args: unknown[]) => R): (...args: unknown[]) => R {
    const context = getCodeContext();
    return () => context.runGenerator(callback);
  }

  emplaceInStorage<ValueType>(key: string | symbol, handler?: EmplaceHandler<ValueType>): ValueType {
    return emplace(this.storage as Map<string | symbol, ValueType>, key, handler);
  }

  run<R>(callback: () => R): R {
    //should we add ...args or args[]? asyncLocalStorage.run(store, callback[, ...args]) does but asyncContext.run does not
    return als.run(this, callback);
  }

  runGenerator<R extends Generator | AsyncGenerator>(callback: () => R): R {
    return this.run(() => {
      const generator = callback();
      //TODO do we need a separate WrappedAsyncGenerator? (if generator[Symbol.iterator] does not exist, it's async) - for now the same wrapper seems to work
      return new WrappedGenerator(this, generator as Generator) as unknown as R;
    });
  }
}

//Not exported through @webhare/services yet. Should we?
export function emplaceInCodeContext<ValueType>(key: string | symbol, handler?: EmplaceHandler<ValueType>): ValueType {
  return als.getStore()?.emplaceInStorage(key, handler) ?? emplace(rootstorage as Map<string | symbol, ValueType>, key, handler);
}

export function getCodeContext(): CodeContext {
  const store = als.getStore();
  if (!store) //We throw because if you use this API you expect to be written for a CodeContext isolation - so it's odd if you wouldn't know that.
    throw new Error("Not running inside a CodeContext");
  return store;
}

/* Should be implemented usingand use the terminology of https://github.com/tc39/proposal-async-context

   but practically use https://nodejs.org/api/async_context.html#class-asynclocalstorage
*/

import { StackTraceItem, getCallStack } from "@mod-system/js/internal/util/stacktrace";
import { flags } from "@webhare/env/src/env";
import { AsyncLocalStorage } from "async_hooks";
import EventSource from "@mod-system/js/internal/eventsource";
import { pick } from "@mod-system/js/internal/util/algorithms";

let contextcounter = 0;

const als = new AsyncLocalStorage<CodeContext>;

type ActiveContextData = {
  trace: StackTraceItem[];
  context: WeakRef<CodeContext>;
};

/// Map of all active CodeContexts, key is id
const activecontexts = new Map<string, ActiveContextData>;

/// Finalization registry to clean up the active contexts
const activecontexts_finalizationregistry = new FinalizationRegistry<string>(id => activecontexts.delete(id));


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

export type CodeContextMetadata = Record<string, string | number | boolean>;

type CodeContextEvents = {
  close: object;
};

//Note that CodeContext is not intended to be AsyncLocalStorage/AsyncContext but it's a specific instance of an async store

/** Context for running async code.
 */
export class CodeContext extends EventSource<CodeContextEvents>{
  readonly id: string;
  readonly title: string;
  readonly metadata: CodeContextMetadata;
  readonly storage = new Map<string | symbol, unknown>();
  private closed = false;

  constructor(title: string, metadata: CodeContextMetadata) {
    super();
    this.id = `whcontext-${++contextcounter}: ${title}`;
    this.title = title;
    this.metadata = metadata;
    const data: ActiveContextData = {
      trace: flags.async ? getCallStack(0) : [],
      context: new WeakRef(this)
    };
    activecontexts.set(this.id, data);
    activecontexts_finalizationregistry.register(this, this.id);
  }

  static wrap<R>(callback: (...args: unknown[]) => R): (...args: unknown[]) => R {
    const context = getCodeContext();
    return () => context.run(callback);
  }

  static wrapGenerator<R extends Generator>(callback: (...args: unknown[]) => R): (...args: unknown[]) => R {
    const context = getCodeContext();
    return () => context.runGenerator(callback);
  }

  ensureScopedResource<ValueType>(key: string | symbol, createcb: (context: CodeContext) => ValueType): ValueType {
    if (this.closed)
      throw new Error(`Cannot call ensureScopedResource on a closed CodeContext`);
    if (this.storage.get(key))
      return this.storage.get(key) as ValueType;
    const retval = createcb(this);
    this.storage.set(key, retval);
    return retval;
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

  close() {
    /// Need to run the close event within this CodeContext, so cleanup can access it.
    this.run(() => this.emit("close", {}));
    this.closed = true;
  }
}

const rootstorage = new CodeContext("root", {});

//Not exported through @webhare/services yet. Should we?
export function ensureScopedResource<ValueType>(key: string | symbol, createcb: (context: CodeContext) => ValueType): ValueType {
  return (als.getStore() ?? rootstorage).ensureScopedResource(key, createcb);
}

export function getCodeContext(): CodeContext {
  const store = als.getStore();
  if (!store) //We throw because if you use this API you expect to be written for a CodeContext isolation - so it's odd if you wouldn't know that.
    throw new Error("Not running inside a CodeContext");
  return store;
}

export function getActiveCodeContexts(): Array<{ id: string; title: string; metadata: CodeContextMetadata; trace: StackTraceItem[]; codecontext: CodeContext }> {
  const retval = [];
  for (const data of activecontexts.values()) {
    const codecontext = data.context.deref();
    if (codecontext) {
      retval.push({ trace: data.trace, codecontext, ...pick(codecontext, ["id", "title", "metadata"]) });
    }
  }
  return retval;
}

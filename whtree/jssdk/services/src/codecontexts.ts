/* Should be implemented usingand use the terminology of https://github.com/tc39/proposal-async-context

   but practically use https://nodejs.org/api/async_context.html#class-asynclocalstorage
*/

import { StackTraceItem, getCallStack } from "@mod-system/js/internal/util/stacktrace";
import { debugFlags } from "@webhare/env";
import { AsyncLocalStorage } from "async_hooks";
import EventSource from "@mod-system/js/internal/eventsource";
import { DebugFlags, setDebugFlagsOverrideCB } from "@webhare/env/src/envbackend";

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
  readonly storage = new Map<string | symbol, { resource: unknown; dispose?: (x: unknown) => void }>();
  private closed = false;
  debugFlagsOverrides: DebugFlags[] = [{}];

  constructor(title: string, metadata: CodeContextMetadata) {
    super();
    this.id = `whcontext-${++contextcounter}: ${title}`;
    this.title = title;
    this.metadata = metadata;
    const data: ActiveContextData = {
      trace: debugFlags.async ? getCallStack(0) : [],
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

  //TODO/FIXME? a '(WebHare) Resource' is a file inside module/on disk/in WHFS in WebHare. scopedResource might be overloading the term Resource
  getScopedResource<ValueType>(key: string | symbol): ValueType | undefined {
    if (this.closed)
      throw new Error(`Cannot get scoped resources from a closed CodeContext`);
    return this.storage.get(key)?.resource as ValueType | undefined;
  }

  ensureScopedResource<ValueType>(key: string | symbol, createcb: (context: CodeContext) => ValueType, dispose?: (val: ValueType) => void): ValueType {
    let retval = this.getScopedResource<ValueType>(key);
    if (retval === undefined) {
      retval = createcb(this);
      this.storage.set(key, {
        resource: retval, dispose: dispose as (x: unknown) => void
      });
    }
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
    this.run(() => {
      this.emit("close", {});
      for (const [, resource] of this.storage)
        resource.dispose?.(resource.resource);
    });
    this.storage.clear();
    this.closed = true;
  }
}

export const rootstorage = new CodeContext("root", {});

// The root storage allows direct access to the debug flags, so remove its flags override records
rootstorage.debugFlagsOverrides = [];

// Register the debug flags override getter function to use the override provided by the code context
setDebugFlagsOverrideCB(() => als.getStore()?.debugFlagsOverrides ?? []);

export function isRootCodeContext(): boolean {
  return als.getStore() === undefined;
}

export function getCodeContext(): CodeContext {
  return als.getStore() ?? rootstorage;
}

export function runOutsideCodeContext<R, TArgs extends unknown[]>(callback: (...args: TArgs) => R, ...args: TArgs): R {
  return als.exit(callback, ...args);
}

export function getScopedResource<ValueType>(key: string | symbol): ValueType | undefined {
  return getCodeContext().getScopedResource<ValueType>(key);
}
export function ensureScopedResource<ValueType>(key: string | symbol, createcb: (context: CodeContext) => ValueType, dispose?: (val: ValueType) => void): ValueType {
  return getCodeContext().ensureScopedResource(key, createcb, dispose);
}


type ActiveCodeContext = {
  /// Stack trace where this context was allocated (only filled when debug flag 'async' is enabled)
  trace: StackTraceItem[];

  /// Code context
  codecontext: CodeContext;
};

/** Returns the list of currently active code contexts
 *
 */
export function getActiveCodeContexts(): ActiveCodeContext[] {
  const retval = [];
  for (const data of activecontexts.values()) {
    const codecontext = data.context.deref();
    if (codecontext) {
      retval.push({ trace: data.trace, codecontext });
    }
  }
  return retval;
}

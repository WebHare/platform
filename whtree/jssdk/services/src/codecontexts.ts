/* Should be implemented usingand use the terminology of https://github.com/tc39/proposal-async-context

   but practically use https://nodejs.org/api/async_context.html#class-asynclocalstorage
*/

import { type StackTraceItem, getCallStack } from "@mod-system/js/internal/util/stacktrace";
import { debugFlags } from "@webhare/env";
import { AsyncLocalStorage } from "async_hooks";
import EventSource from "@mod-system/js/internal/eventsource";
import { type DebugFlags, registerDebugConfigChangedCallback, setDebugFlagsOverrideCB } from "@webhare/env/src/envbackend";
import type { ConsoleLogItem } from "@webhare/env/src/concepts";
import * as async_hooks from "node:async_hooks";
import { registerAsNonReloadableLibrary } from "@webhare/services/src/hmrinternal";

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


class WrappedGenerator<G extends Generator<T, TReturn, TNext>, T = unknown, TReturn = unknown, TNext = unknown> extends Iterator<T, TReturn, TNext> implements Generator<T, TReturn, TNext> {
  codecontext;
  generator;

  constructor(codecontext: CodeContext, generator: G) {
    super();
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
export class CodeContext extends EventSource<CodeContextEvents> implements AsyncDisposable {
  readonly id: string;
  readonly title: string;
  readonly metadata: CodeContextMetadata;
  readonly storage = new Map<string | symbol, { resource: unknown; dispose?: (x: unknown) => void | Promise<void> }>();
  private closed = false;
  readonly consoleLog: ConsoleLogItem[] = [];
  readonly allPromises = new Map<number, PromiseAdminData>;
  readonly mutexes: Set<string> = new Set;
  debugFlagsOverrides: DebugFlags[] = [{}];

  constructor(title: string, metadata: CodeContextMetadata = {}) {
    super();
    this.id = `whcontext-${++contextcounter}: ${title}`;
    if (debugFlags.cclifecycle)
      console.trace(`[${this.id}] CodeContext created`);
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
    if (this.closed) {
      if (debugFlags.cclifecycle)
        console.trace(`[${this.id}] Attempt to get scoped resource '${String(key)}' from closed CodeContext`);
      throw new Error(`Cannot get scoped resources from closed CodeContext '${this.id}'`);
    }
    return this.storage.get(key)?.resource as ValueType | undefined;
  }

  setScopedResource<ValueType>(key: string | symbol, value: ValueType | undefined): void {
    if (this.closed) {
      if (debugFlags.cclifecycle)
        console.trace(`[${this.id}] Attempt to set scoped resource '${String(key)}' on closed CodeContext`);
      throw new Error(`Cannot set scoped resources on a closed CodeContext`);
    }
    if (value === undefined)
      this.storage.delete(key);
    else
      this.storage.set(key, { resource: value });
  }

  ensureScopedResource<ValueType>(key: string | symbol, createcb: (context: CodeContext) => ValueType, dispose?: (val: ValueType) => void | Promise<void>): ValueType {
    let retval = this.getScopedResource<ValueType>(key);
    if (retval === undefined) {
      retval = createcb(this);
      this.storage.set(key, {
        resource: retval,
        dispose: dispose as (x: unknown) => void | Promise<void>
      });
    }
    return retval;
  }

  async releaseScopedResource(key: string | symbol): Promise<void> {
    const res = this.storage.get(key);
    this.storage.delete(key);
    if (res?.dispose)
      await res?.dispose(res.resource);
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

  async close() {
    if (debugFlags.cclifecycle)
      console.trace(`[${this.id}] CodeContext closing`);

    /// Need to run the close event within this CodeContext, so cleanup can access it.
    await this.run(async () => {
      this.emit("close", {});
      for (const [, resource] of this.storage)
        await resource.dispose?.(resource.resource);
    });
    this.storage.clear();
    this.closed = true;

    if (debugFlags.retainers)
      showDanglingPromises(this);
  }

  [Symbol.asyncDispose]() {
    return this.close();
  }

  applyDebugSettings({ flags }: { flags: DebugFlags }) {
    if (!this.debugFlagsOverrides.length)
      throw new Error(`Cannot apply debug settings to the root context`);
    for (const [flag, enabled] of Object.entries(flags))
      if (enabled)
        this.debugFlagsOverrides[0][flag] = true;
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
export function setScopedResource<ValueType>(key: string | symbol, value: ValueType | undefined): void {
  getCodeContext().setScopedResource(key, value);
}
export function ensureScopedResource<ValueType>(key: string | symbol, createcb: (context: CodeContext) => ValueType, dispose?: (val: ValueType) => void | Promise<void>): ValueType {
  return getCodeContext().ensureScopedResource(key, createcb, dispose);
}
export function releaseScopedResource(key: string | symbol): Promise<void> {
  return getCodeContext().releaseScopedResource(key);
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


const promiseAdminSymbol = Symbol("wh-retainers-admin");
type Resource = object & { [promiseAdminSymbol]?: PromiseAdminData };
type PromiseAdminData = {
  promiseAsyncId: number;
  triggerAsyncId: number;
  trace: Error | undefined;
  fulfilled: boolean;
  attached: boolean;
  parentAdminData: PromiseAdminData | undefined;
};

let hook: async_hooks.AsyncHook | undefined;
registerDebugConfigChangedCallback(initHookIfNeeded);

/** Promise this promise won't throw and that its async behaviours are safe (no DB queries etc) */
export function markPromiseSafe(promise: Promise<unknown>) {
  const ctxt = getCodeContext();
  const asyncId = (promise as Resource)[promiseAdminSymbol]?.promiseAsyncId;
  if (asyncId) {
    const adminData = ctxt.allPromises.get(asyncId);
    if (adminData) {
      adminData.attached = true;
      adminData.parentAdminData = undefined;
      ctxt.allPromises.delete(asyncId);
    }
  }
}

let inHook = false;
function initHookIfNeeded() {
  if (debugFlags.retainers && !hook) {
    hook = async_hooks.createHook({
      init(asyncId, type, triggerAsyncId, resource: Resource) {
        // We're using promise.then inside this function to detect promise fulfillment, so we need to avoid recursion
        if (inHook)
          return;
        inHook = true;

        // Get the promise admin data from the parent async resource
        const parentAdminData = (async_hooks.executionAsyncResource() as Resource)[promiseAdminSymbol];
        resource[promiseAdminSymbol] = parentAdminData;
        if (type === "PROMISE") {
          // New promise! Create a new admin data object and store it in the promise
          //process.stdout.write(`Promise created: asyncId:${asyncId} triggerAsyncId:${triggerAsyncId} parentPromise:${parentAdminData?.promiseAsyncId}\n`);
          const adminData = { promiseAsyncId: asyncId, triggerAsyncId, parentAdminData, trace: new Error, fulfilled: false, attached: false };
          resource[promiseAdminSymbol] = adminData;

          const ctxt = getCodeContext();

          // When the promise is resolved or rejected, mark it as fulfilled (rejected promises that aren't caught are caught by the unhandled rejection handlers)
          const promise = resource as Promise<unknown>;
          const handler = () => {
            adminData.fulfilled = true;
            // Remove the parentAdminData. We lose the parent info here we could use to eliminate false positives, but it's probably not worth the memory cost
            adminData.parentAdminData = undefined;
            ctxt.allPromises.delete(asyncId);
          };
          promise.then(handler, handler);

          // If the triggerAsyncId is a promise, assume this is a .then on the promise and mark the parent promise as attached
          const triggerPromise = ctxt.allPromises.get(triggerAsyncId);
          if (triggerPromise) {
            triggerPromise.attached = true;
            // Remove the parentAdminData. We lose the parent info here we could use to eliminate false positives, but it's probably not worth the memory cost
            triggerPromise.parentAdminData = undefined;
            ctxt.allPromises.delete(triggerAsyncId);
          }
          ctxt.allPromises.set(asyncId, adminData);
        }
        inHook = false;
      },
      before(asyncId) {
        /* called for promises when they have been fulfilled. Needed to eliminate some false positives (you would guess that the promise.then
           done in the init hook would be enough, but it's not) */
        //process.stdout.write(`before: asyncId:${asyncId}\n`);
        const ctxt = getCodeContext();
        const adminData = ctxt.allPromises.get(asyncId);
        if (adminData) {
          adminData.attached = true;
          // Remove the parentAdminData. We lose the parent info here we could use to eliminate false positives, but it's probably not worth the memory cost
          adminData.parentAdminData = undefined;
          ctxt.allPromises.delete(asyncId);
        }
      }
    }).enable();
  } else if (hook && !debugFlags.retainers) {
    hook.disable();
    hook = undefined;
  }
}

function showDanglingPromises(context: CodeContext) {
  if (context.allPromises.size) {
    /* debug code to show all pending+unattached promises
    function abbrevTrace(e: Error) {
      const trace = cutPromiseInitHookTracePart(e.stack || "");
      return trace?.split("\n").slice(1).map(s => s.replace(/^ *at( *)/, "").replace(/^([^ ]*).*\/([^)]*)(.*)/g, "$2 ($1)")).join(",") ?? "";
    }

    function getAsyncIds(promise: PromiseAdminData): number[] {
      const ids = [];
      for (let adminData: typeof promise | undefined = promise; adminData; adminData = adminData.parentAdminData)
        ids.push(adminData.promiseAsyncId);
      return ids;
    }

    console.table([...this.allPromises.values()].map(c => ({
      ...c,
      parentFulfilled: c.parentAdminData?.fulfilled,
      parentAdminData: c.parentAdminData ? "set" : undefined,
      triggerIds: getAsyncIds(c),
      trace: abbrevTrace(c.trace!).substring(0, 60)
    })));
    */

    // Show only the first promise of a parent asyncId (and check parentAdminData recursively shown asyncIds)
    const shownParentAsyncIds = new Set<number>();
    promiseLoop:
    for (const adminData of context.allPromises.values()) {
      if (!adminData.fulfilled && !adminData.attached && (adminData.parentAdminData?.fulfilled ?? true)) {
        for (let testAdminData: typeof adminData | undefined = adminData; testAdminData; testAdminData = testAdminData.parentAdminData) {
          if (shownParentAsyncIds.has(testAdminData.promiseAsyncId))
            continue promiseLoop;
        }

        if (adminData.parentAdminData)
          shownParentAsyncIds.add(adminData.parentAdminData.promiseAsyncId);
        console.error(`Warning: promise not resolved at codeContext close, allocated:`, cutPromiseInitHookTracePart(adminData.trace?.stack));
      }
    }
  }
}

function cutPromiseInitHookTracePart(trace: string | undefined) {
  if (trace) {
    const idx = trace.indexOf("promiseInitHook");
    if (idx !== -1)
      trace = "\n" + trace.substring(trace.indexOf("\n", idx) + 1);
  }
  return trace || "<unknown>";
}

// This library keeps important data in global variables, cannot reload
registerAsNonReloadableLibrary(module);

initHookIfNeeded();

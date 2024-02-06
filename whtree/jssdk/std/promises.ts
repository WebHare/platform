import { WaitPeriod, convertWaitPeriodToDate } from "./datetime";

/// A deferred promise with typed result value
export type DeferredPromise<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason: Error) => void;
};

/** A promise that sleeps for the specified number of milliseconds
 *  @param duration - Relative (milliseconds, but not Infinity) or absolute (Date) wait duration. May not be Infinity
 *  @param options - Options - `signal` to set an AbortSignal which will canel this sleep
*/
export async function sleep(duration: WaitPeriod, options?: { signal?: AbortSignal }): Promise<void> {
  if (duration === Infinity)
    throw new Error(`A sleep may not be infinite`);

  const until = convertWaitPeriodToDate(duration);
  return new Promise(resolve => {
    const timeoutid = setTimeout(resolve, Math.max(0, until.getTime() - Date.now()));
    if (options?.signal)
      options.signal.addEventListener("abort", () => clearTimeout(timeoutid));
  });
}

/** Create a promise together with resolve & reject functions

    @typeParam T - expected type of Resolve
    @returns Deferred promise
 */
export function createDeferred<T>(): DeferredPromise<T> {
  let resolve: (value: T | PromiseLike<T>) => void;
  let reject: (reason: Error) => void;
  const promise = new Promise<T>((_resolve, _reject) => { resolve = _resolve; reject = _reject; });
  // @ts-ignore `resolve` and `reject` are assigned synchronously, which isn't picked up by the TypeScript compiler (see
  // https://github.com/Microsoft/TypeScript/issues/30053)
  return { promise, resolve, reject };
}

/** Wrap a promise in a timeout
 * @param promise - Promise to wrap
 * @param timeout - Timeout in milliseconds or as a Date
 * @param rejectWith - Error to reject with if the timeout expires (string, Error, or a callback returning one)
*/
export function wrapInTimeout<T>(promise: Promise<T>, timeout: WaitPeriod, rejectWith: string | Error | (() => string | Error)): Promise<T> {
  if (timeout === Infinity)
    return promise;

  const until = convertWaitPeriodToDate(timeout);
  const timeoutpromise = new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      //this approach allows to delay actual Error object construction
      const error: string | Error = typeof rejectWith === "function" ? rejectWith() : rejectWith;
      reject(typeof error === "object" ? error : new Error(error));
    }, until.getTime() - Date.now());

    //ensure timer cancellation
    promise.finally(() => clearTimeout(timer));
  });

  return Promise.race([promise, timeoutpromise]);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- we need to accept any callback.
type CallbackFunctionVariadic<RetType> = (...args: any[]) => Promise<RetType>;

export interface SerializeOptions {
  ///Coalescing will ignore intermediate calls if the original call has not completed yet. Eg when invoking functions 1,2,3 in succession, only 3 will run, calls 1 and 2 will be merged into that call
  coalesce?: boolean;
}

class Coalescer<RetVal> {
  private queue: Array<DeferredPromise<RetVal>> = [];
  private call: CallbackFunctionVariadic<RetVal> | null = null;
  private readonly fn: CallbackFunctionVariadic<RetVal>;

  //invoke is the actual entry point for incoming calls (ie C++'s operator() )
  readonly invoke: CallbackFunctionVariadic<RetVal>;

  constructor(fn: CallbackFunctionVariadic<RetVal>) {
    this.invoke = this.onInvoke.bind(this);
    this.fn = fn;
  }
  private onInvoke(...args: unknown[]): Promise<RetVal> {
    //overwrite the call to execute
    this.call = () => this.fn(...args); //TODO just queueing the parameters might do?

    if (!this.queue.length) //schedule a flush of the queue
      setTimeout(() => this.flush(), 0);

    this.queue.push(createDeferred<RetVal>());
    return this.queue[this.queue.length - 1].promise;
  }

  private async flush() {
    for (let startpos = 0; this.queue && startpos < this.queue?.length;) {
      const currentpos = this.queue?.length;

      try {
        //invoke the last known call. *NOTE* new calls may be added to the queue now
        const result = await this.call!();
        for (let i = startpos; i < currentpos; i++)
          this.queue[i].resolve(result);
      } catch (e) {
        for (let i = startpos; i < currentpos; i++)
          this.queue[i].reject(e as Error);
      }
      startpos = currentpos;
    }
    //empty the queue
    this.queue.splice(0, this.queue.length);
  }
}

// export function<Fn extends (...args: any[]) => Promise<any>>(fn: Fn, options?: SerializeOptions): Fn {
// type RetVal = ReturnType<Fn>;

/** Wrap a function in a serializer */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- we need to accept any callback.
export function wrapSerialized<Fn extends (...args: any[]) => Promise<any>>(fn: Fn, options?: SerializeOptions): Fn {
  type RetVal = ReturnType<Fn>;
  if (options?.coalesce)
    return (new Coalescer<RetVal>(fn)).invoke as Fn;

  let queue = Promise.resolve() as Promise<unknown>;
  return ((...args: unknown[]): Promise<RetVal> => {
    const res = queue.then(() => fn(...args));
    queue = res.catch(() => { /* ignore errors */ });
    return res;
  }) as Fn;
}

//TODO abandon the name 'serialize' for now so it's free and safe to use once JS Decorators land (so we can use @serialize there)
/** @deprecated Use wrapSerialized instead */
export function serialize<RetVal>(fn: (...args: unknown[]) => Promise<RetVal>, context: unknown) {
  return wrapSerialized(fn, undefined);
}

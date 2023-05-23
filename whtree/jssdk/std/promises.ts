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
    const timeoutid = setTimeout(resolve, until.getTime() - Date.now());
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

/** Wrap a function in a serializer */
export function serialize<RetVal>(fn: (...args: unknown[]) => Promise<RetVal>, context: unknown) {
  let queue = Promise.resolve() as Promise<unknown>;
  return (...args: unknown[]): Promise<RetVal> => {
    const res = queue.then(() => fn(...args));
    queue = res.catch(() => { /* ignore errors */ });
    return res;
  };
}

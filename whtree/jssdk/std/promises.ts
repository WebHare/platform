import { WaitPeriod, convertWaitPeriodToDate } from "./api";

/// A deferred promise with typed result value
export type DeferredPromise<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason: Error) => void;
};

/** A promise that sleeps for the specified number of milliseconds
 *  @param duration - Relative (milliseconds) or absolute (Date) wait duration
*/
export async function sleep(duration: WaitPeriod): Promise<void> {
  const until = convertWaitPeriodToDate(duration);
  await new Promise(resolve => setTimeout(resolve, Date.now() - until.getTime()));
  return;
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

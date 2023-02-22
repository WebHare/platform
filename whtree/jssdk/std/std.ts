/// A deferred promise with typed result value
export type DeferredPromise<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason: Error) => void;
};

/** A promise that sleeps for the specified number of milliseconds
 *  @param milliseconds - Number of milliseconds to sleep. Must be 0 or more
*/
export async function sleep(milliseconds: number): Promise<void> {
  if (milliseconds < 0)
    throw new Error(`Wait duration must be positive, got '${milliseconds}'`);
  await new Promise(resolve => setTimeout(resolve, milliseconds));
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

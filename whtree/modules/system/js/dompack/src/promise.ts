import { DeferredPromise } from "../../types";

/**
     Create a promise together with resolve & reject functions
 *
    @returns Deferred promise
 */
export function createDeferred<T>(): DeferredPromise<T>
{
  let resolve: (value: T | PromiseLike<T>) => void;
  let reject: (reason: Error) => void;
  const promise = new Promise<T>((_resolve, _reject) => { resolve = _resolve; reject = _reject; });
  // @ts-ignore `resolve` and `reject` are assigned synchronously, which isn't picked up by the TypeScript compiler (see
  // https://github.com/Microsoft/TypeScript/issues/30053)
  return { promise, resolve, reject };
}

import { debugFlags } from "@webhare/env";

/** Throws an unhandled rejection if a promise isn't awaited on within a few milliseconds after
 *  its creation if the `async` debug flag is enabled
 */
export function checkPromiseErrorsHandled<T>(promise: Promise<T>): Promise<T> {
  if (!debugFlags.async)
    return promise;

  // Prepare an error to get a stack trace
  const preparederror = new Error(`Rejected promises from the called function are not handled`);
  let handlesrejections = false;

  // Warn after 5 milli seconds, should be enough for handlers to be attached.
  setTimeout(() => {
    // Throw an unhandled rejection if no handlers attacked
    if (!handlesrejections)
      throw preparederror;
  }, 5);

  // Implementation that is compatible with the TypeScript type for Promise.
  return {
    [Symbol.toStringTag]: promise[Symbol.toStringTag],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): Promise<TResult1 | TResult2> {
      if (onrejected)
        handlesrejections = true;
      return promise.then(onfulfilled, onrejected);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): Promise<T | TResult> {
      handlesrejections = true;
      return promise.catch(onrejected);
    },
    finally(onfinally?: (() => void) | undefined | null): Promise<T> {
      return promise.finally(onfinally);
    }
  };
}

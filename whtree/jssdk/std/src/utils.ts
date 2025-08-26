function propagateAbort(signal: AbortSignal, cb: ((reason: typeof signal["reason"]) => void) | AbortController) {
  if (signal.aborted) {
    if ("abort" in cb)
      cb.abort(signal.reason);
    else
      cb(signal.reason);
  } else signal.addEventListener("abort", () => {
    if ("abort" in cb)
      cb.abort(signal.reason);
    else
      cb(signal.reason);
  });
}

export type AbortSignals = Iterable<AbortSignal | Promise<AbortSignal> | undefined | null> | AbortSignal | Promise<AbortSignal> | null | undefined;

/** Calls the callback when any of the passed abort signals is (or already was) aborted. Use
 * this instead of addEventListener when it is possible that any of the abortsignals was already aborted.
*/
export function whenAborted(signals: AbortSignals, cb: ((reason: AbortSignal["reason"]) => void) | AbortController): void {
  propagateAbort(combineAbortSignals(signals), cb);
}

/** Combines abort signals (or promises for abort signals) into one abort signal. More generic version of AbortSignal.any() */
export function combineAbortSignals(signals: AbortSignals): AbortSignal {
  if (!signals || !(Symbol.iterator in signals))
    signals = [signals];
  const abortController = new AbortController;
  for (const signal of signals) {
    if (signal) {
      if ("then" in signal) {
        // Convert promise errors to abort
        void signal.then(s => propagateAbort(s, abortController), e => abortController.abort(e));
      } else
        propagateAbort(signal, abortController);
    }
  }
  return abortController.signal;
}

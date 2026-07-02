import { isPromise } from "./quacks";

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

/** Returns a signal that can be used like `using signal = getScopeSignal()` and will be aborted when going out of scope */
export function getScopeSignal(): AbortSignal & { [Symbol.dispose](): void } {
  const ctrl = new AbortController();
  const signal = ctrl.signal as AbortSignal & { [Symbol.dispose](): void };
  signal[Symbol.dispose] = () => ctrl.abort();
  return signal;
}

type PipeReturn<PFinal, PAll extends readonly unknown[]> = Extract<PAll[number], Promise<unknown>> extends never ? PFinal : Promise<Awaited<PFinal>>;

/** @hidden */
export function pipe<P1>(f1: P1 | ((a: void) => P1)): PipeReturn<P1, [P1]>;
export function pipe<P1, P2>(f1: P1 | ((a: void) => P1), f2: (b: Awaited<P1>) => P2): PipeReturn<P2, [P1, P2]>;
export function pipe<P1, P2, P3>(f1: P1 | ((a: void) => P1), f2: (b: Awaited<P1>) => P2, f3: (c: Awaited<P2>) => P3): PipeReturn<P3, [P1, P2, P3]>;
export function pipe<P1, P2, P3, P4>(f1: P1 | ((a: void) => P1), f2: (b: Awaited<P1>) => P2, f3: (c: Awaited<P2>) => P3, f4: (d: Awaited<P3>) => P4): PipeReturn<P4, [P1, P2, P3, P4]>;
export function pipe<P1, P2, P3, P4, P5>(f1: P1 | ((a: void) => P1), f2: (b: Awaited<P1>) => P2, f3: (c: Awaited<P2>) => P3, f4: (d: Awaited<P3>) => P4, f5: (e: Awaited<P4>) => P5): PipeReturn<P5, [P1, P2, P3, P4, P5]>;
export function pipe<P1, P2, P3, P4, P5, P6>(f1: P1 | ((a: void) => P1), f2: (b: Awaited<P1>) => P2, f3: (c: Awaited<P2>) => P3, f4: (d: Awaited<P3>) => P4, f5: (e: Awaited<P4>) => P5, f6: (f: Awaited<P5>) => P6): PipeReturn<P6, [P1, P2, P3, P4, P5, P6]>;
export function pipe<P1, P2, P3, P4, P5, P6, P7>(f1: P1 | ((a: void) => P1), f2: (b: Awaited<P1>) => P2, f3: (c: Awaited<P2>) => P3, f4: (d: Awaited<P3>) => P4, f5: (e: Awaited<P4>) => P5, f6: (f: Awaited<P5>) => P6, f7: (g: Awaited<P6>) => P7): PipeReturn<P7, [P1, P2, P3, P4, P5, P6, P7]>;
export function pipe<P1, P2, P3, P4, P5, P6, P7, P8>(f1: P1 | ((a: void) => P1), f2: (b: Awaited<P1>) => P2, f3: (c: Awaited<P2>) => P3, f4: (d: Awaited<P3>) => P4, f5: (e: Awaited<P4>) => P5, f6: (f: Awaited<P5>) => P6, f7: (g: Awaited<P6>) => P7, f8: (h: Awaited<P7>) => P8): PipeReturn<P8, [P1, P2, P3, P4, P5, P6, P7, P8]>;
export function pipe<P1, P2, P3, P4, P5, P6, P7, P8, P9>(f1: P1 | ((a: void) => P1), f2: (b: Awaited<P1>) => P2, f3: (c: Awaited<P2>) => P3, f4: (d: Awaited<P3>) => P4, f5: (e: Awaited<P4>) => P5, f6: (f: Awaited<P5>) => P6, f7: (g: Awaited<P6>) => P7, f8: (h: Awaited<P7>) => P8, f9: (i: Awaited<P8>) => P9): PipeReturn<P9, [P1, P2, P3, P4, P5, P6, P7, P8, P9]>;
export function pipe<P1, P2, P3, P4, P5, P6, P7, P8, P9, P10>(f1: P1 | ((a: void) => P1), f2: (b: Awaited<P1>) => P2, f3: (c: Awaited<P2>) => P3, f4: (d: Awaited<P3>) => P4, f5: (e: Awaited<P4>) => P5, f6: (f: Awaited<P5>) => P6, f7: (g: Awaited<P6>) => P7, f8: (h: Awaited<P7>) => P8, f9: (i: Awaited<P8>) => P9, f10: (j: Awaited<P9>) => P10): PipeReturn<P10, [P1, P2, P3, P4, P5, P6, P7, P8, P9, P10]>;
export function pipe<P1, P2, P3, P4, P5, P6, P7, P8, P9, P10, P11>(f1: P1 | ((a: void) => P1), f2: (b: Awaited<P1>) => P2, f3: (c: Awaited<P2>) => P3, f4: (d: Awaited<P3>) => P4, f5: (e: Awaited<P4>) => P5, f6: (f: Awaited<P5>) => P6, f7: (g: Awaited<P6>) => P7, f8: (h: Awaited<P7>) => P8, f9: (i: Awaited<P8>) => P9, f10: (j: Awaited<P9>) => P10, f11: (k: Awaited<P10>) => P11): PipeReturn<P11, [P1, P2, P3, P4, P5, P6, P7, P8, P9, P10, P11]>;
export function pipe<P1, P2, P3, P4, P5, P6, P7, P8, P9, P10, P11, P12>(f1: P1 | ((a: void) => P1), f2: (b: Awaited<P1>) => P2, f3: (c: Awaited<P2>) => P3, f4: (d: Awaited<P3>) => P4, f5: (e: Awaited<P4>) => P5, f6: (f: Awaited<P5>) => P6, f7: (g: Awaited<P6>) => P7, f8: (h: Awaited<P7>) => P8, f9: (i: Awaited<P8>) => P9, f10: (j: Awaited<P9>) => P10, f11: (k: Awaited<P10>) => P11, f12: (l: Awaited<P11>) => P12): PipeReturn<P12, [P1, P2, P3, P4, P5, P6, P7, P8, P9, P10, P11, P12]>;
export function pipe<P1, P2, P3, P4, P5, P6, P7, P8, P9, P10, P11, P12, P13>(f1: P1 | ((a: void) => P1), f2: (b: Awaited<P1>) => P2, f3: (c: Awaited<P2>) => P3, f4: (d: Awaited<P3>) => P4, f5: (e: Awaited<P4>) => P5, f6: (f: Awaited<P5>) => P6, f7: (g: Awaited<P6>) => P7, f8: (h: Awaited<P7>) => P8, f9: (i: Awaited<P8>) => P9, f10: (j: Awaited<P9>) => P10, f11: (k: Awaited<P10>) => P11, f12: (l: Awaited<P11>) => P12, f13: (m: Awaited<P12>) => P13): PipeReturn<P13, [P1, P2, P3, P4, P5, P6, P7, P8, P9, P10, P11, P12, P13]>;
export function pipe<P1, P2, P3, P4, P5, P6, P7, P8, P9, P10, P11, P12, P13, P14>(f1: P1 | ((a: void) => P1), f2: (b: Awaited<P1>) => P2, f3: (c: Awaited<P2>) => P3, f4: (d: Awaited<P3>) => P4, f5: (e: Awaited<P4>) => P5, f6: (f: Awaited<P5>) => P6, f7: (g: Awaited<P6>) => P7, f8: (h: Awaited<P7>) => P8, f9: (i: Awaited<P8>) => P9, f10: (j: Awaited<P9>) => P10, f11: (k: Awaited<P10>) => P11, f12: (l: Awaited<P11>) => P12, f13: (m: Awaited<P12>) => P13, f14: (n: Awaited<P13>) => P14): PipeReturn<P14, [P1, P2, P3, P4, P5, P6, P7, P8, P9, P10, P11, P12, P13, P14]>;
export function pipe<P1, P2, P3, P4, P5, P6, P7, P8, P9, P10, P11, P12, P13, P14, P15>(f1: P1 | ((a: void) => P1), f2: (b: Awaited<P1>) => P2, f3: (c: Awaited<P2>) => P3, f4: (d: Awaited<P3>) => P4, f5: (e: Awaited<P4>) => P5, f6: (f: Awaited<P5>) => P6, f7: (g: Awaited<P6>) => P7, f8: (h: Awaited<P7>) => P8, f9: (i: Awaited<P8>) => P9, f10: (j: Awaited<P9>) => P10, f11: (k: Awaited<P10>) => P11, f12: (l: Awaited<P11>) => P12, f13: (m: Awaited<P12>) => P13, f14: (n: Awaited<P13>) => P14, f15: (o: Awaited<P14>) => P15): PipeReturn<P15, [P1, P2, P3, P4, P5, P6, P7, P8, P9, P10, P11, P12, P13, P14, P15]>;
export function pipe<P1, P2, P3, P4, P5, P6, P7, P8, P9, P10, P11, P12, P13, P14, P15, P16>(f1: P1 | ((a: void) => P1), f2: (b: Awaited<P1>) => P2, f3: (c: Awaited<P2>) => P3, f4: (d: Awaited<P3>) => P4, f5: (e: Awaited<P4>) => P5, f6: (f: Awaited<P5>) => P6, f7: (g: Awaited<P6>) => P7, f8: (h: Awaited<P7>) => P8, f9: (i: Awaited<P8>) => P9, f10: (j: Awaited<P9>) => P10, f11: (k: Awaited<P10>) => P11, f12: (l: Awaited<P11>) => P12, f13: (m: Awaited<P12>) => P13, f14: (n: Awaited<P13>) => P14, f15: (o: Awaited<P14>) => P15, f16: (p: Awaited<P15>) => P16): PipeReturn<P16, [P1, P2, P3, P4, P5, P6, P7, P8, P9, P10, P11, P12, P13, P14, P15, P16]>;

/** Chain together (possibly async) function calls, each receiving the resolved (awaited) output of the previous one. The first parameter may be a value, all further parameters must be functions.
 *  Type safe up to 16 parameters
 */
export function pipe(fn0: unknown, ...fns: Array<(x: unknown) => unknown>): unknown;

export function pipe(fn0: unknown, ...fns: Array<(x: unknown) => unknown>): unknown {
  let result = typeof fn0 === "function" ? fn0() : fn0;

  if (isPromise(result)) { //switch to full async handling immediately
    return (async () => {
      let asyncResult = await result;
      for (const fn of fns)
        asyncResult = await fn(asyncResult);
      return asyncResult;
    })();
  }

  for (let idx = 0; idx < fns.length; ++idx) {
    const next = fns[idx](result);
    if (isPromise(next)) { //switch to async as soon as we hit a promise
      return (async () => {
        let asyncResult = await next;
        for (let asyncIdx = idx + 1; asyncIdx < fns.length; ++asyncIdx)
          asyncResult = await fns[asyncIdx](asyncResult);
        return asyncResult;
      })();
    }
    result = next;
  }

  return result;
}

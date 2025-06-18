const monitorStack: TestMonitor[] = [];
const dummyAbortPromise = Promise.resolve();

export class TestMonitor implements Disposable {
  #abortController = new AbortController();
  #abortDefer = Promise.withResolvers<void>();
  /// Active waiters
  waiters = new Array<Waiter>();

  constructor() {
    monitorStack.push(this);
    this.#abortDefer.promise.catch(() => { /* ignore */ }); //make sure they don't abort the process due to uncaughtRejection
  }

  [Symbol.dispose]() {
    const idx = monitorStack.indexOf(this);
    if (idx >= 0)
      monitorStack.splice(idx, 1);
  }

  get abortSignal() {
    return this.#abortController.signal;
  }

  /** Add this promise to races to receive a rejection when an abort is requested */
  get abortPromise() {
    return this.#abortDefer.promise;
  }

  waitState(): string {
    return this.waiters.map(_ => _.waitType).join(" > ");
  }

  abort() {
    this.#abortController.abort();
    this.#abortDefer.reject(new Error("Test aborted"));
  }
}

/** Class to allocate during test waits to receive aborts */
class Waiter implements Disposable {
  constructor(private monitor: TestMonitor | null, public waitType: string) {
    this.monitor?.waiters.push(this);
  }
  [Symbol.dispose]() {
    const idx = this.monitor?.waiters.indexOf(this);
    if (idx !== undefined && idx >= 0)
      this.monitor?.waiters.splice(idx, 1);
  }
  /** Add this promise to races to receive a rejection when an abort is requested */
  get abortPromise() {
    return this.monitor?.abortPromise ?? dummyAbortPromise;
  }
  //Match Promise.Race signature: <T extends readonly unknown[] | []>(values: T): Promise<Awaited<T[number]>>;
  async race<T extends readonly unknown[] | []>(toRace: T): Promise<Awaited<T[number]>> {
    if (!this.monitor)
      return await Promise.race(toRace);

    return await Promise.race([this.monitor.abortPromise, ...toRace]) as Awaited<T[number]>;
  }
  get signal(): AbortSignal | undefined {
    return this.monitor?.abortSignal;
  }
}

export function getMonitor(): TestMonitor | null {
  return monitorStack.at(-1) ?? null;
}

export function flagWait(waitType: string): Waiter {
  return new Waiter(getMonitor(), waitType);
}

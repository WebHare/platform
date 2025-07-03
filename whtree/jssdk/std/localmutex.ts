const unlock = Symbol("unlock");

/** A mutex which is only visible in the current JavaScript VM

    @example
```ts
const mutex = new LocalMutex;

using lock = await mutex.lock();
lock.release();

// If you'll be relying on automatic release
using lock = await mutex.lock();
void(lock);
```

*/
export class LocalMutex {
  private locked = false;
  private unlockList = new Array<() => void>;

  /** Lock this mutex
   * @returns Lock object. Use with `using` to ensure automatic unlock
   */
  async lock() {
    if (this.locked) {
      const defer = Promise.withResolvers<void>();
      this.unlockList.push(() => defer.resolve());
      await defer.promise;
    } else {
      this.locked = true;
    }
    return new LocalLock(this);
  }

  [unlock](): void {
    if (this.unlockList.length > 0)
      (this.unlockList.shift()!)(); //we're fair... unlock longest waiter
    else
      this.locked = false;
  }
}

/** Instance of a LocalMutex lock */
class LocalLock implements Disposable {
  private mutex: LocalMutex | null;

  constructor(mutex: LocalMutex) {
    this.mutex = mutex;
  }
  /** Explicitly release the lock
   * @throws Error if the lock is already released
  */
  release() {
    if (!this.mutex)
      throw new Error("Lock already released");

    this.mutex[unlock]();
    this.mutex = null;
  }
  [Symbol.dispose]() {
    this.mutex?.[unlock]();
  }
}

export type { LocalLock };

export class LocalMutex {
  private locked = false;
  private unlockList = new Array<() => void>;

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

  unlock(options?: { okIfUnlocked: boolean }): void {
    if (!this.locked)
      if (options?.okIfUnlocked)
        return;
      else
        throw new Error("Cannot unlock a mutex that is not locked");

    if (this.unlockList.length > 0)
      (this.unlockList.shift()!)(); //we're fair... unlock longest waiter
    else
      this.locked = false;
  }
}

class LocalLock implements Disposable {
  private readonly mutex: LocalMutex;

  constructor(mutex: LocalMutex) {
    this.mutex = mutex;
  }
  release() {
    this.mutex.unlock();
  }
  [Symbol.dispose]() {
    this.mutex.unlock({ okIfUnlocked: true });
  }
}

export type { LocalLock };

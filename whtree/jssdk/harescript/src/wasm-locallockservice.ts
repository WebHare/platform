import type { WebHareServiceIPCLinkType } from "@mod-system/js/internal/types";
import { debugFlags } from "@webhare/env/src/envbackend";
import { registerAsNonReloadableLibrary } from "@webhare/services/src/hmr";
import { LocalService, LocalServiceHandlerBase } from "@webhare/services/src/localservice";



export async function openLocalLockService(link: WebHareServiceIPCLinkType["AcceptEndPoint"]) {
  return new LocalServiceHandlerBase("local:localLockService", (groupId: string) => new LocalLockService(groupId), { dropListenerReference: true });
}

type LockQueueEntry = {
  lock: HSLock;
  processData: LocalLockService;
  maxConcurrent: number;
  locked: boolean;
  waitStart: Date | null;
  lockStart: Date | null;
};

type HSLock = {
  lockId: number;
  name: string;
  lockWaiter: PromiseWithResolvers<boolean>;
  processData: LocalLockService;
};

class LockData {
  name: string;
  lockQueue = new Array<LockQueueEntry>;

  constructor(name: string) {
    this.name = name;
  }

  enableLockEvents() {
    let now: Date | undefined;
    let maxConcurrent = Number.MAX_SAFE_INTEGER;
    let count = 0;
    let reachedEnd = true;
    for (const itr of this.lockQueue) {
      ++count;
      if (itr.maxConcurrent < maxConcurrent)
        maxConcurrent = itr.maxConcurrent;
      if (count > maxConcurrent) {
        reachedEnd = false;
        break;
      }
      if (!itr.locked) {
        now ??= new Date;
        itr.lock.lockWaiter.resolve(true);
        itr.lockStart = now;
        itr.locked = true;
        itr.processData.waitFor = null;
      }
    }
    return reachedEnd;
  }
}

type HSLockManagerStatus = Array<{
  name: string;
  lockId: number;
  maxConcurrent: number;
  lockPosition: number;
  groupLockPosition: number;
  waiting: boolean;
  waitStart: Date | null;
  lockStart: Date | null;
  groupId: string;
}>;

class HSLockManager {

  locks = new Map<string, LockData>;
  processes = new Set<LocalLockService>;


  addQueueEntry(hslock: HSLock, maxConcurrent: number, failIfQueued: boolean) {
    const now = new Date;

    if (hslock.processData.waitFor)
      throw new Error(`Process is already waiting on lock ${JSON.stringify(hslock.processData.waitFor.name)}, can only wait on one at a time`);

    let lockData = this.locks.get(hslock.name);
    if (!lockData)
      this.locks.set(hslock.name, lockData = new LockData(hslock.name));

    const entry: LockQueueEntry = {
      lock: hslock,
      maxConcurrent: maxConcurrent,
      locked: false,
      waitStart: now,
      lockStart: null,
      processData: hslock.processData,
    };

    lockData.lockQueue.push(entry);
    const result = lockData.enableLockEvents();
    if (!result && failIfQueued) {
      lockData.lockQueue.pop();
      if (!lockData.lockQueue.length)
        this.locks.delete(hslock.name);
      return false;
    }
    this.processes.add(hslock.processData);
    hslock.processData.locks.push(entry);
    if (!result) {
      hslock.processData.waitFor = lockData;
      if (debugFlags["locallocks"])
        console.log(`Entering deadlock detection, for group lockdata ${hslock.processData.groupId}`);

      let maxIter = this.processes.size + 1;
      let waitLock = lockData;
      let withSemaphores = false;
      while (maxIter) {
        if (debugFlags["locallocks"])
          console.log(` considering lock ${waitLock.name} iter ${maxIter}`);

        const front = waitLock.lockQueue[0];
        if (front.maxConcurrent !== 1) {
          withSemaphores = true;
          if (debugFlags["locallocks"])
            console.log(`  detected semaphore lock, skip rest of mutex-only-deadlock check`);
          break;
        }
        if (debugFlags["locallocks"])
          console.log(`  mutex held by ${front.processData.groupId}`);
        if (front.processData === hslock.processData) {
          // that's the current process, deadlock
          if (debugFlags["locallocks"])
            console.log(`   that's the current process, deadlock`);
          maxIter = 0;
          break;
        }
        if (!front.processData.waitFor) {
          if (debugFlags["locallocks"])
            console.log(`   Process not waiting, break`);
          // process not waiting, break;
          break;
        }
        waitLock = front.processData.waitFor;
        --maxIter;
      }
      if (withSemaphores && this.isDeadlockPresent())
        maxIter = 0;
      if (!maxIter) {
        this.removeQueueEntry(hslock);
        throw new Error(`Deadlock detected when waiting on lock ${JSON.stringify(hslock.name)}`);
      }
    }

    return result;
  }

  isDeadlockPresent() {
    if (debugFlags["locallocks"]) {
      console.log("Entering heavy deadlock detection");
      console.log(" Processes:");
    }
    for (const processData of this.processes) {
      processData.noDeadlock = !processData.waitFor;
      if (debugFlags["locallocks"])
        console.log(`  ${processData.groupId}, noDeadlock: ${processData.noDeadlock}`);
    }

    let allReachedEnd: boolean;
    for (; ;) {
      let anyChange = false;
      allReachedEnd = true;

      if (debugFlags["locallocks"])
        console.log(` Loop through locks`);

      for (const lockData of this.locks.values()) {
        let maxConcurrent = Number.MAX_SAFE_INTEGER;
        let count = 0;
        for (const entry of lockData.lockQueue) {
          if (entry.lock.processData.noDeadlock)
            continue;
          ++count;
          if (entry.maxConcurrent < maxConcurrent)
            maxConcurrent = entry.maxConcurrent;
          if (count > maxConcurrent) {
            allReachedEnd = false;
            break;
          }
          if (entry.lock.processData.waitFor === lockData) {
            if (debugFlags["locallocks"])
              console.log(`  ${entry.lock.processData.groupId} mark as noDeadlock`);
            entry.lock.processData.noDeadlock = true;
            anyChange = true;
          }
        }
      }
      if (!anyChange)
        break;
    }

    if (debugFlags["locallocks"])
      console.log(`Finalized heavy deadlock detection: ${allReachedEnd ? "no deadlock" : "deadlock"}`);
    return !allReachedEnd;
  }

  removeQueueEntry(hslock: HSLock) {
    const lockData = this.locks.get(hslock.name);
    if (!lockData)
      return;

    for (let idx = lockData.lockQueue.length - 1; idx >= 0; --idx) {
      const entry = lockData.lockQueue[idx];
      if (entry.lock === hslock) {
        lockData.lockQueue.splice(idx, 1);
        if (!lockData.lockQueue.length)
          this.locks.delete(hslock.name);
        else
          lockData.enableLockEvents();
        if (hslock.processData.waitFor === lockData)
          hslock.processData.waitFor = null;
        const lidx = hslock.processData.locks.findIndex(l => l === entry);
        if (lidx >= 0) {
          hslock.processData.locks.splice(lidx, 1);
          if (!hslock.processData.locks.length)
            this.processes.delete(hslock.processData);
        }
        break;
      }
    }
  }

  getLockStatus(): HSLockManagerStatus {
    const retval: HSLockManagerStatus = [];
    for (const lockData of this.locks.values()) {
      let maxConcurrent = Number.MAX_SAFE_INTEGER;
      let count = 0;
      for (const entry of lockData.lockQueue) {
        ++count;
        if (entry.maxConcurrent < maxConcurrent)
          maxConcurrent = entry.maxConcurrent;

        const lockOrder = entry.lock.processData.locks.findIndex(e => e === entry);

        retval.push({
          name: entry.lock.name,
          lockId: entry.lock.lockId,
          maxConcurrent: entry.maxConcurrent,
          lockPosition: count - 1,
          groupLockPosition: lockOrder,
          waiting: count > maxConcurrent,
          waitStart: entry.waitStart,
          lockStart: entry.lockStart,
          groupId: entry.lock.processData.groupId,
        });
      }
    }
    return retval;
  }
}

let globalLockManager: HSLockManager | undefined;
let lockIdCounter = 0;


export class LocalLockService extends LocalService {
  locks = new Array<LockQueueEntry>;
  waitFor: LockData | null = null;
  lockManager: HSLockManager;
  groupId: string;
  noDeadlock = true;

  constructor(groupId: string) {
    super();
    this.groupId = groupId;
    this.lockManager = (globalLockManager ??= new HSLockManager);
  }

  openLock(name: string, maxConcurrent: number, failIfQueued: boolean): { lockId: number; locked: boolean } {
    if (maxConcurrent < 1)
      throw new Error(`Illegal maxConcurrent value ${maxConcurrent}`);
    const hslock = {
      lockId: ++lockIdCounter,
      name,
      lockWaiter: Promise.withResolvers<boolean>(),
      processData: this
    };

    const result = this.lockManager.addQueueEntry(hslock, maxConcurrent, failIfQueued);
    if (!result && failIfQueued)
      return { lockId: 0, locked: false };

    return { lockId: hslock.lockId, locked: result };
  }

  async waitLock(lockId: number): Promise<boolean> {
    const lockEntry = this.locks.find(l => l.lock.lockId === lockId);
    if (!lockEntry)
      throw new Error(`Could not find lock`);
    const retval = await lockEntry.lock.lockWaiter.promise;
    return retval;
  }

  closeLock(lockId: number): void {
    const lockEntry = this.locks.find(l => l.lock.lockId === lockId);
    if (!lockEntry) {
      throw new Error(`Could not find lock with id ${lockId}`);
    }
    this.lockManager.removeQueueEntry(lockEntry.lock);
    lockEntry.lock.lockWaiter.resolve(false);
  }

  getStatus(): HSLockManagerStatus {
    return this.lockManager.getLockStatus();
  }

  _gotClose(): void {
    // .slice because we need to make a copy, entries will be removed by closeLock messing up iteration
    for (const entry of this.locks.slice())
      this.closeLock(entry.lock.lockId);
  }
}

registerAsNonReloadableLibrary(module);

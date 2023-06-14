import * as domdebug from './debug';
import * as domevents from './events';
import { createDeferred, DeferredPromise } from "@webhare/std";

let locallocks: BusyLock[] = [];
let ischild = false;
interface LockManagerWindow extends Window {
  __dompack_busylockmanager: LockManager;
}

export type BusyModalEvent = CustomEvent<{ show: boolean }>;

export interface Lock {
  release(): void;
}

declare global {
  interface GlobalEventHandlersEventMap {
    "dompack:busymodal": BusyModalEvent;
  }
}

class LockManager {
  locks: BusyLock[];
  busycounter: number;
  deferreduipromise: DeferredPromise<boolean> | null;
  uiwatcher: NodeJS.Timeout | null;
  modallocked: boolean;

  //this object is not for external consumption
  constructor() {
    this.locks = [];
    this.busycounter = 0;
    this.deferreduipromise = null;
    this.uiwatcher = null;
    this.modallocked = false;
  }
  anyModalLocks() {
    for (const lock of this.locks)
      if (lock.modal)
        return true;
    return false;
  }
  add(lock: BusyLock) {
    this.locks.push(lock);
    const returnvalue = this.busycounter++;

    if (lock.modal && !this.modallocked) {
      this.modallocked = true;

      //'islock' is legacy non-camel version. TypeScript typing should help us transition
      if (domevents.dispatchCustomEvent(window, 'dompack:busymodal', { bubbles: true, cancelable: true, detail: { show: true, islock: true } }))
        document.documentElement.classList.add("dompack--busymodal");
    }
    return returnvalue;
  }
  release(lock: BusyLock) {
    const pos = this.locks.indexOf(lock);
    if (pos == -1) {
      if (domdebug.debugflags.bus) {
        console.error("Duplicate release of busy lock #" + lock.locknum);
        console.log("Lock allocated:");
        console.log(lock.acquirestack);
        console.log("Lock first released:");
        console.log(lock.releasestack);
      }
      throw new Error("Duplicate release of busy lock");
    }

    this.locks.splice(pos, 1);
    this.prepWatcher();
  }
  prepWatcher() {
    if (!this.uiwatcher && this.locks.length == 0 && (this.deferreduipromise || this.modallocked)) {
      this.uiwatcher = setTimeout(() => this.checkUIFree(), 0);
    }
  }
  getNumLocks() {
    return this.locks.length;
  }
  checkUIFree() {
    this.uiwatcher = null;
    if (this.locks.length == 0) {
      if (this.deferreduipromise) {
        this.deferreduipromise.resolve(true);
        this.deferreduipromise = null;
      }
      if (this.modallocked && !this.anyModalLocks()) {
        this.modallocked = false;
        if (domevents.dispatchCustomEvent(window, 'dompack:busymodal', { bubbles: true, cancelable: true, detail: { islock: false, show: false } }))
          document.documentElement.classList.remove("dompack--busymodal");
      }
    }
  }
  waitUIFree() {
    if (!this.deferreduipromise)
      this.deferreduipromise = createDeferred();
    this.prepWatcher();
    return this.deferreduipromise.promise;
  }
  logLocks() {
    this.locks.forEach(lock => console.log('[bus] lock #' + lock.locknum, lock.acquirestack, lock));
    console.log("[bus] total " + this.locks.length + " locks");
  }
  getLockIds() {
    return this.locks.map(l => "#" + l.locknum).join(", ");
  }
}

let lockmgr: LockManager = getParentLockManager() || new LockManager;

interface LockOptions {
  modal: boolean;
}

class BusyLock implements Lock {
  modal: boolean;
  locknum: number;
  acquirestack: string | undefined;
  releasestack: string | undefined;

  constructor(options?: LockOptions) {
    //legacy non-camel name is 'ismodal'
    this.modal = options?.modal ?? (options as { ismodal?: boolean })?.ismodal ?? false;

    this.locknum = lockmgr.add(this);
    if (ischild)
      locallocks.push(this);

    if (domdebug.debugflags.bus) {
      this.acquirestack = (new Error).stack;
      console.trace('[bus] Busy lock #' + this.locknum + ' taken. ' + lockmgr.getNumLocks() + " locks active now: " + lockmgr.getLockIds());
    }
  }
  release() {
    if (domdebug.debugflags.bus)
      this.releasestack = (new Error).stack;

    lockmgr.release(this);
    if (ischild) {
      const lockpos = locallocks.indexOf(this);
      locallocks.splice(lockpos, 1);
    }

    if (domdebug.debugflags.bus) {
      console.trace('[bus] Busy lock #' + this.locknum + ' released. ' + lockmgr.getNumLocks() + " locks active now: " + lockmgr.getLockIds());
    }
  }
}

/** Return a promise resolving as soon as the UI is free for at least one tick */
export function waitUIFree() {
  return lockmgr.waitUIFree();
}

/**
     flag userinterface as busy. tests then know not to interact with the UI until the busy flag is released
 *
    @param options - Options.<br>
                   - modal: true/false - Whether the lock is a modal lock
 */
export function flagUIBusy(options?: LockOptions): Lock {
  return new BusyLock(options);
}

export function getUIBusyCounter() {
  return lockmgr.busycounter;
}

function getParentLockManager(): LockManager | null {
  try { //we're accessing a parent window, so we may hit security exceptions
    const parent = window.parent as LockManagerWindow;
    if (!(parent && parent.__dompack_busylockmanager))
      return null;

    ischild = true;

    //if we connected to a parent...  deregister our locks, eg. if parent navigated our frame away
    window.addEventListener("unload", () => {
      if (domdebug.debugflags.bus)
        console.log("[bus] Frame unloading, " + locallocks.length + " locks pending.", locallocks.map(l => "#" + l.locknum).join(", "), locallocks);

      //switch to local instance as we'll be unable to auto-release
      const locallockmgr = new LockManager;
      locallocks.forEach(lock => { lockmgr.release(lock); locallockmgr.add(lock); });
      locallocks = [];
      lockmgr = locallockmgr;
    });

    return parent.__dompack_busylockmanager;
  } catch (e) {
    return null;
  }
}

if (!lockmgr)
  lockmgr = new LockManager;

if (typeof window !== 'undefined')
  (window as unknown as LockManagerWindow).__dompack_busylockmanager = lockmgr;

import { flags } from '@webhare/env';
import * as domevents from '../../../modules/system/js/dompack/src/events';
import { createDeferred, DeferredPromise } from "@webhare/std";

let locallocks: BusyLock[] = [];
let modallocked = false;
let uiwatcher: NodeJS.Timeout | null = null;

interface LockManagerWindow extends Window {
  __dompack_busylockmanager: LockManager;
}

let currentbusymodaldialog: HTMLDialogElement | null = null;
let busymodalcontent: string | undefined;

export type BusyModalEvent = CustomEvent<{ show: boolean }>;

export interface Lock {
  release(): void;
}

declare global {
  interface GlobalEventHandlersEventMap {
    "dompack:busymodal": BusyModalEvent;
  }
}

function anyModalLocks() {
  return locallocks.some(l => l.modal);
}

/* scheduleCheckUIFree is invoked by release() or when waitUIFree is explicitly called. the call from release() should
   be a 'fast' path. We schedule a full check for the next tick if there's a chance it might actually find a free UI */
function scheduleCheckUIFree() {
  if (!uiwatcher && locallocks.length == 0)
    uiwatcher = setTimeout(() => checkUIFree(), 0);
}

/* check if the UI is actually free. if so, remove busymodals and resolve waitUIFrees for the benefit of testfw  */
function checkUIFree() {
  uiwatcher = null;
  if (locallocks.length === 0)
    lockmgr.checkUIFree(); //to resolve any waitUIFrees. runs in the top-level frame. note that lockmgr cares about ALL ui locks

  if (modallocked && !anyModalLocks()) { //did the last frame-level *modal* lock just get released?
    modallocked = false;
    toggleBusyModal(false);
  }
}

function toggleBusyModal(show: boolean) {
  //'islock' is legacy non-camel version. TypeScript typing should help us transition (since 5.3)
  if (!domevents.dispatchCustomEvent(window, 'dompack:busymodal', { bubbles: true, cancelable: true, detail: { show: show, islock: show } }))
    return; //cancelled!

  if (show) {
    if (busymodalcontent) {
      const dialog = document.createElement('dialog');
      const toembed = document.createTextNode(busymodalcontent);
      dialog.className = "dompack-busydialog";
      dialog.append(toembed);
      document.body.appendChild(dialog);
      currentbusymodaldialog = dialog;
      dialog.showModal();
      return;
    }

    document.documentElement.classList.add("dompack--busymodal");
    return;
  }

  //hiding
  document.documentElement.classList.remove("dompack--busymodal");
  if (currentbusymodaldialog) { //we added a dialog to the dom
    currentbusymodaldialog.close();
    document.body.removeChild(currentbusymodaldialog);
    currentbusymodaldialog = null;
  }
}

class LockManager {
  locks: BusyLock[];
  busycounter: number;
  deferreduipromise: DeferredPromise<boolean> | null;

  //this object is not for external consumption
  constructor() {
    this.locks = [];
    this.busycounter = 0;
    this.deferreduipromise = null;
  }
  add(lock: BusyLock) {
    this.locks.push(lock);
    const returnvalue = this.busycounter++;
    return returnvalue;
  }
  release(lock: BusyLock) {
    const pos = this.locks.indexOf(lock);
    if (pos == -1) {
      if (flags.bus) {
        console.error("Duplicate release of busy lock #" + lock.locknum);
        console.log("Lock allocated:");
        console.log(lock.acquirestack);
        console.log("Lock first released:");
        console.log(lock.releasestack);
      }
      throw new Error("Duplicate release of busy lock");
    }

    this.locks.splice(pos, 1);
  }
  getNumLocks() {
    return this.locks.length;
  }
  //used by child windows to schedule a check in *our* frame (eg before they themselves are unloaded)
  scheduleCheckUIFree() {
    scheduleCheckUIFree();
  }
  checkUIFree() {
    if (this.locks.length == 0 && this.deferreduipromise) {
      this.deferreduipromise.resolve(true);
      this.deferreduipromise = null;
    }
  }
  waitUIFree() {
    if (!this.deferreduipromise)
      this.deferreduipromise = createDeferred();

    scheduleCheckUIFree(); //ensures uiwait is released at next tick if no locks are present at all
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

/** Configure an (accessible) modal dialog
 * @param bmc - The text to show in the dialog
 */
export function setupBusyModal(bmc: NonNullable<typeof busymodalcontent>) {
  busymodalcontent = bmc;
}

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
    locallocks.push(this);

    if (this.modal && !modallocked) {
      modallocked = true;
      toggleBusyModal(true);
    }

    if (flags.bus) {
      this.acquirestack = (new Error).stack;
      console.trace('[bus] Busy lock #' + this.locknum + ' taken. ' + lockmgr.getNumLocks() + " locks active now: " + lockmgr.getLockIds());
    }
  }
  release() {
    if (flags.bus)
      this.releasestack = (new Error).stack;

    lockmgr.release(this);
    const lockpos = locallocks.indexOf(this);
    locallocks.splice(lockpos, 1);

    if (flags.bus) {
      console.trace('[bus] Busy lock #' + this.locknum + ' released. ' + lockmgr.getNumLocks() + " locks active now: " + lockmgr.getLockIds());
    }

    scheduleCheckUIFree();
  }
}

/** Return a promise resolving as soon as the UI (any accessible frame) is free for at least one tick */
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

    //if we connected to a parent...  deregister our locks, eg. if parent navigated our frame away
    window.addEventListener("unload", () => {
      if (flags.bus)
        console.log("[bus] Frame unloading, " + locallocks.length + " locks pending.", locallocks.map(l => "#" + l.locknum).join(", "), locallocks);

      //switch to local instance in case anyone still tries to touch these locks during unload
      const locallockmgr = new LockManager;
      locallocks.forEach(lock => { lockmgr.release(lock); locallockmgr.add(lock); });
      locallocks = [];

      lockmgr.scheduleCheckUIFree();
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

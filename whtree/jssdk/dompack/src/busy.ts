import { debugFlags } from '@webhare/env';
import * as domevents from '../../../modules/system/js/dompack/src/events';
import "@webhare/tsrun/src/polyfills";

let locallocks: BusyLock[] = [];
let modallocked = false;
let uiwatcher: NodeJS.Timeout | null = null;
let installedanticancelhandler = false;

let currentbusymodaldialog: HTMLDialogElement | null = null;
let currentbusymodaluserdialog: HTMLDialogElement | null = null;
let busymodalcontent: string | HTMLElement | HTMLDialogElement | undefined;
let mylockmgr: LockManager | undefined;

export type BusyModalEvent = CustomEvent<{ show: boolean }>;

// As 'Lock' already exists on the Web (https://developer.mozilla.org/docs/Web/API/Lock) and it's seldom used just use a longer name. Available since WH 5.4
export interface UIBusyLock extends Disposable {
  release(): void;
  [Symbol.dispose](): void;
}

declare global {
  interface GlobalEventHandlersEventMap {
    "dompack:busymodal": BusyModalEvent;
  }
  interface Window {
    __dompack_busylockmanager?: LockManager;
  }

  // __dompack_busylockmanager: LockManager | undefined;  //
}

function getLockmgr(): LockManager {
  if (!mylockmgr) {
    mylockmgr = getParentLockManager() || new LockManager;
    if (typeof window !== "undefined")
      window.__dompack_busylockmanager = mylockmgr;
  }
  return mylockmgr;
}

function anyModalLocks() {
  return locallocks.some(l => l.modal);
}

/* scheduleCheckUIFree is invoked by release() or when waitUIFree is explicitly called. the call from release() should
   be a 'fast' path. We schedule a full check for the next tick if there's a chance it might actually find a free UI */
function scheduleCheckUIFree() {
  if (!uiwatcher && locallocks.length === 0)
    uiwatcher = setTimeout(() => checkUIFree(), 0);
}

/* check if the UI is actually free. if so, remove busymodals and resolve waitUIFrees for the benefit of testfw  */
function checkUIFree() {
  uiwatcher = null;

  if (modallocked && !anyModalLocks()) { //did the last frame-level *modal* lock just get released?
    modallocked = false;
    toggleBusyModal(false);
  }

  if (locallocks.length === 0) {
    const lockmgr = getLockmgr();
    lockmgr.busyframes.delete(window); //we won't release our block in the lockmanager until we've had a chance to remove our modal layer
    lockmgr.checkUIFree(); //to resolve any waitUIFrees. runs in the top-level frame. note that lockmgr cares about ALL ui locks, not just modals
  }
}

function isDialogElement(el: unknown): boolean {
  return typeof el === "object" && (el as HTMLElement).matches?.("dialog") || false;
}

function checkCancelEvent(evt: Event) {
  if (modallocked)
    evt.preventDefault();
}

function toggleBusyModal(show: boolean) {
  //'islock' is legacy non-camel version. TypeScript typing should help us transition (since 5.3). 'as' shuts up the warning TODO remove 'islock' and the 'as'
  if (!domevents.dispatchCustomEvent(window, 'dompack:busymodal', { bubbles: true, cancelable: true, detail: { show: show, islock: show } as BusyModalEvent['detail'] }))
    return; //cancelled!

  if (!installedanticancelhandler) {
    //capture cancel, as it doesn't bubble up
    addEventListener("cancel", evt => checkCancelEvent(evt), { capture: true });
    installedanticancelhandler = true;
  }

  if (show) {
    if (isDialogElement(busymodalcontent)) { //the user provided us with an element
      currentbusymodaluserdialog = busymodalcontent as HTMLDialogElement;
      currentbusymodaluserdialog.showModal();
    } else if (busymodalcontent) { //we'll create our own dialog
      const dialog = document.createElement('dialog');
      const toembed = typeof busymodalcontent === "string" ? document.createTextNode(busymodalcontent) : busymodalcontent.cloneNode(true);
      dialog.className = "dompack-busydialog";
      dialog.role = "status";
      dialog.ariaLive = "off";
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
  if (currentbusymodaluserdialog)
    currentbusymodaluserdialog.close();
  if (currentbusymodaldialog) { //we added a dialog to the dom
    currentbusymodaldialog.close();
    document.body.removeChild(currentbusymodaldialog);
    currentbusymodaldialog = null;
  }
}

class LockManager {
  locks: BusyLock[];
  busyframes: Set<Window> = new Set;
  busycounter: number;
  deferreduipromise: PromiseWithResolvers<boolean> | null;

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
    if (pos === -1) {
      if (debugFlags.bus) {
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
    if (this.locks.length === 0 && this.busyframes.size === 0 && this.deferreduipromise) {
      this.deferreduipromise.resolve(true);
      this.deferreduipromise = null;
    }
  }
  waitUIFree() {
    if (!this.deferreduipromise)
      this.deferreduipromise = Promise.withResolvers();

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

/** Configure an (accessible) modal dialog
 * @param bmc - What to show in the dialog: either a text or DOM fragment to clone.
 *              If a <dialog> element is passed, this dialog will be used instead of creating a new one.
 */
export function setupBusyModal(bmc: NonNullable<typeof busymodalcontent>) {
  busymodalcontent = bmc;
}

interface LockOptions {
  ///Whether this lock should enable a modality laayer
  modal?: boolean;
}

class BusyLock implements UIBusyLock {
  modal: boolean;
  locknum: number;
  acquirestack: string | undefined;
  releasestack: string | undefined;

  constructor(options?: LockOptions) {
    //legacy non-camel name is 'ismodal'
    this.modal = options?.modal ?? (options as { ismodal?: boolean })?.ismodal ?? false;

    const lockmgr = getLockmgr();
    this.locknum = lockmgr.add(this);
    lockmgr.busyframes.add(window);
    locallocks.push(this);

    if (this.modal && !modallocked) {
      modallocked = true;
      toggleBusyModal(true);
    }

    if (debugFlags.bus) {
      this.acquirestack = (new Error).stack;
      console.trace('[bus] Busy lock #' + this.locknum + ' taken. ' + lockmgr.getNumLocks() + " locks active now: " + lockmgr.getLockIds());
    }
  }

  [Symbol.dispose]() {
    if (debugFlags.bus)
      this.releasestack = (new Error).stack;

    const lockmgr = getLockmgr();
    lockmgr.release(this);
    const lockpos = locallocks.indexOf(this);
    locallocks.splice(lockpos, 1);

    if (debugFlags.bus) {
      console.trace('[bus] Busy lock #' + this.locknum + ' released. ' + lockmgr.getNumLocks() + " locks active now: " + lockmgr.getLockIds());
    }

    scheduleCheckUIFree();
  }

  release() {
    this[Symbol.dispose]();
  }
}

/** Return a promise resolving as soon as the UI (any accessible frame) is free for at least one tick */
export function waitUIFree() {
  return getLockmgr().waitUIFree();
}

/**
     flag userinterface as busy. tests then know not to interact with the UI until the busy flag is released
 *
    @param options - Options.<br>
                   - modal: true/false - Whether the lock is a modal lock
 */
export function flagUIBusy(options?: LockOptions): UIBusyLock {
  return new BusyLock(options);
}

export function getUIBusyCounter() {
  return getLockmgr().busycounter;
}

function getParentLockManager(): LockManager | null {
  try { //we're accessing a parent window, so we may hit security exceptions
    if (!(window.parent?.__dompack_busylockmanager))
      return null;

    //if we connected to a parent...  deregister our locks, eg. if parent navigated our frame away
    window.addEventListener("pagehide", () => {
      if (debugFlags.bus)
        console.log("[bus] Frame unloading, " + locallocks.length + " locks pending.", locallocks.map(l => "#" + l.locknum).join(", "), locallocks);

      //switch to local instance in case anyone still tries to touch these locks during unload
      const lockmgr = getLockmgr();
      const locallockmgr = new LockManager;
      locallocks.forEach(lock => { lockmgr.release(lock); locallockmgr.add(lock); });
      locallocks = [];

      lockmgr.busyframes.delete(window); //explicitly remove us so we won't be waited upon
      lockmgr.scheduleCheckUIFree();
      mylockmgr = locallockmgr;
    });

    return window.parent.__dompack_busylockmanager;
  } catch (e) {
    return null;
  }
}

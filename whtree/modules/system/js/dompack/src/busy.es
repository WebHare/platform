import * as domdebug from './debug.es';
import * as dompromise from './promise.es';
import * as domevents from './events.es';

let lockmgr = null;
let locallocks = [];
let ischild = false;

class LockManager
{
  //this object is not for external consumption
  constructor()
  {
    this.locks = [];
    this.busycounter = 0;
    this.deferreduipromise = null;
    this.uiwatcher = null;
    this.modallocked = false;
  }
  anyModalLocks()
  {
    for(var lock of this.locks)
      if(lock.ismodal)
        return true;
    return false;
  }
  add(lock)
  {
    this.locks.push(lock);
    let returnvalue = this.busycounter++;

    if(lock.ismodal && !this.modallocked)
    {
      this.modallocked = true;

      if(domevents.dispatchCustomEvent(window, 'dompack:busymodal', { bubbles: true, cancelable: true, detail: { islock: true } }))
        document.documentElement.classList.add("dompack--busymodal");
    }
    return returnvalue;
  }
  release(lock)
  {
    let pos = this.locks.indexOf(lock);
    if(pos==-1)
    {
      if(domdebug.debugflags.bus)
      {
        console.error("Duplicate release of busy lock #" + lock.locknum);
        console.log("Lock allocated:");
        console.log(lock.acquirestack);
        console.log("Lock first released:");
        console.log(lock.releasestack);
      }
      throw new Error("Duplicate release of busy lock");
    }

    this.locks.splice(pos,1);
    this.prepWatcher();
  }
  prepWatcher()
  {
    if(!this.uiwatcher && this.locks.length==0 && (this.deferreduipromise || this.modallocked))
    {
      this.uiwatcher = setTimeout(() => this.checkUIFree(),0);
    }
  }
  getNumLocks()
  {
    return this.locks.length;
  }
  checkUIFree()
  {
    this.uiwatcher = null;
    if(this.locks.length == 0)
    {
      if(this.deferreduipromise)
      {
        this.deferreduipromise.resolve(true);
        this.deferreduipromise = null;
      }
      if(this.modallocked && !this.anyModalLocks())
      {
        this.modallocked = false;
        if(domevents.dispatchCustomEvent(window, 'dompack:busymodal', { bubbles: true, cancelable: true, detail: { islock: false } }))
          document.documentElement.classList.remove("dompack--busymodal");
      }
    }
  }
  waitUIFree()
  {
    if(!this.deferreduipromise)
      this.deferreduipromise = dompromise.createDeferred();
    this.prepWatcher();
    return this.deferreduipromise.promise;
  }
  logLocks()
  {
    this.locks.forEach( (lock,idx) => console.log('[bus] lock #' + lock.locknum, lock.acquirestack, lock) );
    console.log("[bus] total " + this.locks.length + " locks");
  }
  getLockIds()
  {
    return this.locks.map(l => "#" + l.locknum).join(", ");
  }
}

export class Lock
{
  constructor(options)
  {
    this.ismodal = options && options.ismodal;

    this.locknum = lockmgr.add(this);
    if(ischild)
      locallocks.push(this);

    if(domdebug.debugflags.bus)
    {
      this.acquirestack = (new Error).stack;
      console.trace('[bus] Busy lock #' + this.locknum + ' taken. ' + lockmgr.getNumLocks() + " locks active now: " + lockmgr.getLockIds());
    }
  }
  release()
  {
    if(domdebug.debugflags.bus)
      this.releasestack = (new Error).stack;

    lockmgr.release(this);
    if(ischild)
    {
      let lockpos = locallocks.indexOf(this);
      locallocks.splice(lockpos,1);
    }

    if(domdebug.debugflags.bus)
    {
      console.trace('[bus] Busy lock #' + this.locknum + ' released. ' + lockmgr.getNumLocks() + " locks active now: " + lockmgr.getLockIds());
    }
  }
}

/** Return a promise resolving as soon as the UI is free for at least one tick */
export function waitUIFree()
{
  return lockmgr.waitUIFree();
}

/** flag userinterface as busy. tests then know not to interact with the UI until the busy flag is released
    @param options Options
    @cell options.ismodal Whether the lock is a modal lock
*/
export function flagUIBusy(options)
{
  return new Lock(options);
}

export function getUIBusyCounter()
{
  return lockmgr.busycounter;
}

try //we're accessing a parent window, so we may hit security exceptions
{
  if(window.parent && window.parent.$dompack$busylockmanager)
  {
    lockmgr = window.parent.$dompack$busylockmanager;
    ischild = true;
    //if we connected to a parent...  deregister our locks, eg. if parent navigated our frame away
    window.addEventListener("unload", () =>
    {
      if(domdebug.debugflags.bus)
        console.log("[bus] Frame unloading, " + locallocks.length + " locks pending.", locallocks.map(l=>"#"+l.locknum).join(", "), locallocks);

      //switch to local instance as we'll be unable to auto-release
      let locallockmgr = new LockManager;
      locallocks.forEach(lock => { lockmgr.release(lock); locallockmgr.add(lock); });
      locallocks = [];
      lockmgr = locallockmgr;
    });
  }
}
catch(e)
{
}

if(!lockmgr)
  lockmgr = new LockManager;

if(typeof window != 'undefined')
  window.$dompack$busylockmanager = lockmgr;

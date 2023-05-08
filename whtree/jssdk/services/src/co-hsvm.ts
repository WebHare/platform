import { HSVM, HSVMObject, openHSVM } from '@webhare/services/src/hsvm';
import { isWorkOpen, onFinishWork } from '@webhare/whdb';
import { ensureScopedResource } from './codecontexts';

class CoVM {
  vm: HSVM;
  primary: HSVMObject;
  workopen = false;

  constructor(vm: HSVM, primary: HSVMObject) {
    this.vm = vm;
    this.primary = primary;
  }

  async extendWork() {
    if (this.workopen)
      return; //done

    await this.primary.beginWork();
    this.workopen = true;
    return onFinishWork({ onRollback: () => this.finishRemote(false), onCommit: () => this.finishRemote(true) });
  }

  async finishRemote(commit: boolean) {
    this.workopen = false;
    if (commit)
      await this.primary.commitWork();
    else
      await this.primary.rollbackWork();
  }

  close() {
    this.vm.close();
  }
}

const cache = new Array<CoVM>;

const covmsymbol = Symbol("WHCoVM");

let activecovms = 0, maxactivecovms = 0, silentintervals = 0;
let startedcovm = false;
let cleanupinterval: NodeJS.Timer | undefined;

async function promiseVM() {
  const vm = await openHSVM();
  const database = vm.loadlib("mod::system/lib/database.whlib");
  const primary = await database.openPrimary() as HSVMObject;
  return new CoVM(vm, primary);
}

function cleanupCoVMCache() {
  if (startedcovm)
    silentintervals = 0;
  else
    ++silentintervals;

  /* Keep enough covms in cache to scale up to maxactivecovms of the last interval, plus 4
     extra. Unless last covm was allocated 5 minutes ago, then clear the cache.
  */
  const keepcached = silentintervals < 10 ? 4 : 0;
  const todelete = cache.splice(maxactivecovms - activecovms + keepcached);

  for (const elt of todelete) {
    elt.close();
  }
  maxactivecovms = activecovms;
  startedcovm = false;
}

async function getCurrentCoVM() {
  if (!cleanupinterval) {
    cleanupinterval = setInterval(cleanupCoVMCache, 30 * 1000);
    cleanupinterval.unref();
  }

  return ensureScopedResource(covmsymbol, (context) => {
    const covmFromCache = cache.shift();
    const retval = covmFromCache ? Promise.resolve(covmFromCache) : promiseVM();
    startedcovm = true;
    ++activecovms;
    //console.log(`activecovms: ${activecovms}, testing ${testing}, cache: ${cache.length}: ${covmFromCache ? "from cache" : "new"}`);
    if (maxactivecovms < activecovms)
      maxactivecovms = activecovms;
    const cbid = context.on("close", () => {
      --activecovms;

      context.off(cbid);
      retval.then(async covm => {
        try {
          if (await covm.vm.loadlib("mod::system/lib/internal/jshelpers.whlib").TestCoVMReusable() === true) {
            /* round-robin through the first 4 cache items, then use fifo for the rest of the items - so the last
               items in the cache (that will be discarded first) are used the least
            */
            cache.splice(4, 0, covm);
          } else {
            covm.close();
          }
        } catch (e) {
          covm.close();
        }
      });
    });
    return retval;
  });
}

/** Get the co HSVM - boot if needed */
export async function getCoHSVM(): Promise<HSVM> {
  return (await getCurrentCoVM()).vm;
}

/** Make sure work is open in both our VM and the co VM */
export async function extendWorkToCoHSVM() {
  if (!isWorkOpen())
    throw new Error(`This action requires open work (whdb.beginWork)`);

  const vm = await getCurrentCoVM();
  await vm.extendWork();
}

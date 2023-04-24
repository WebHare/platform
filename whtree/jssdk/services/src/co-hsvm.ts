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

async function promiseVM() {
  const vm = await openHSVM();
  const database = vm.loadlib("mod::system/lib/database.whlib");
  const primary = await database.openPrimary() as HSVMObject;
  return new CoVM(vm, primary);
}
const covmsymbol = Symbol("WHCoVM");

async function getCurrentCoVM() {
  return ensureScopedResource(covmsymbol, (context) => {
    const retval = promiseVM();
    const cbid = context.on("close", () => {
      context.off(cbid);
      retval.then(vm => vm.close());
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

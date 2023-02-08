import { HSVM, HSVMObject, openHSVM } from '@webhare/services/src/hsvm';
import { isWorkOpen, onFinishWork } from '@webhare/whdb';

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
}

//TODO myvm should be in AsyncStorage?
let myvm: Promise<CoVM> | null = null;

async function promiseVM() {
  const vm = await openHSVM();
  const database = vm.loadlib("mod::system/lib/database.whlib");
  const primary = await database.openPrimary() as HSVMObject;
  return new CoVM(vm, primary);
}

async function getCurrentCoVM() {
  if (!myvm) //launch it
    myvm = promiseVM();

  return myvm;
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

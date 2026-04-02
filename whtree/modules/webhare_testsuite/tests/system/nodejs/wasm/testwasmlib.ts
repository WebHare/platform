import type { HSVMWrapper } from "@webhare/harescript";
import { sleep } from "@webhare/std";

class NestingHandler {
  constructor(public vm: HSVMWrapper) { }
  topLevelPromise = Promise.withResolvers<void>();
  seondLevelPromise = Promise.withResolvers<void>();
}

let curNestingHandler: NestingHandler | null = null;

export function startNestingHandler(vm: HSVMWrapper) {
  if (curNestingHandler)
    throw new Error("NestingHandler already active");
  curNestingHandler = new NestingHandler(vm);
  return curNestingHandler;
}

export async function invokeSecondNestedCall() {
  if (!curNestingHandler)
    throw new Error("No active NestingHandler");

  //Return topLevelPromise to the caller, and while he's waiting, we'll invoke a call on the HSVM
  void sleep(50).then(() => curNestingHandler!.vm.loadlib("mod::webhare_testsuite/tests/system/nodejs/wasm/testwasmlib.whlib").NestedCallTest2());
  return curNestingHandler.topLevelPromise.promise;
}

export async function resolveNestedCalls() {
  if (!curNestingHandler)
    throw new Error("No active NestingHandler");

  //The VM shoud have entered us again. We return the secondLevelPromise so the VM will wait for that... and on a delay. we'll resolve the topLevelPromise. and only then the secondLevelPromise. can the VM escape ?
  void sleep(50).then(() => curNestingHandler!.topLevelPromise.resolve());
  void sleep(150).then(() => curNestingHandler!.seondLevelPromise.resolve());
  return curNestingHandler.seondLevelPromise.promise;
}

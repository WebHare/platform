import { HSVM, HSVMObject, openHSVM } from '@webhare/services/src/hsvm';
import { openSchema } from "@webhare/wrd";

let myvm: Promise<HSVM> | null = null;

async function promiseVM() {
  const vm = await openHSVM();
  // const database = vm.loadlib("mod::system/lib/database.whlib");
  // await database.openPrimary();
  return vm;
}

export async function getWRDSchema() {
  const wrdschema = await openSchema("wrd:testschema");
  if (!wrdschema)
    throw new Error(`wrd:testschema not found. wrd not enabled for this test run?`);
  return wrdschema;
}

export async function prepareTestFramework(options?: { wrdauth?: boolean }) {
  if (!myvm)
    myvm = promiseVM();

  // options := ValidateOptions([ wrdauth := FALSE ], options);
  const vm = await myvm;
  await vm.loadlib("mod::system/lib/database.whlib").SetPrimaryWebhareTransaction(0);
  //for convenience we'll reuse RunTestframework's various cleanups/resets as much as possible
  await vm.loadlib("mod::system/lib/testframework.whlib").RunTestframework([], options);
  //testfw will insist on opening one, so close it immediately
  const primary = await vm.loadlib("mod::system/lib/database.whlib").GetPrimary() as HSVMObject;
  await primary.close();
}

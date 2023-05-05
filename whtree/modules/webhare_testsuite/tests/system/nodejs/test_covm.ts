import * as test from "@webhare/test";
import { HSVM, HSVMObject } from "@webhare/services/src/hsvm";
import { getCoHSVM } from "@webhare/services/src/co-hsvm";


async function runObjTestCoVM(covm: HSVM, sleep: number) {
  const invoketarget = covm.loadlib("mod::webhare_testsuite/tests/system/nodejs/data/invoketarget.whlib");
  // Get a reference to the test object. Optionally with (synchronous!) sleep
  const obj = await invoketarget.GetObject(sleep) as HSVMObject;
  // Test the ref
  return await obj.test();
}

async function testCoVM() {
  const covm = await getCoHSVM();

  // STORY: test 'No such unmarshallable #XXX' errors

  /* JS cleanups for dropped objects removed the HS mapping, while a new mapping was already sent
     by HS. When the mapping was sent back to HS, it was already gone
  */

  // Get the first reference. It won't be referenced after the first call, so the next GC will clean it up
  await runObjTestCoVM(covm, 0);

  // Get the next reference. Wait asynchronously in HS to make sure the cleanup call is sent during the wait
  // HS will map the return values before processing the cleanup.
  const p = runObjTestCoVM(covm, 10);
  // Trigger the garbage collection during the GetObject call
  await test.triggerGarbageCollection();
  await p;
}

test.run([testCoVM], { wrdauth: false });

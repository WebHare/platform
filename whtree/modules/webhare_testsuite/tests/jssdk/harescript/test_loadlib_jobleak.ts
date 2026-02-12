import { loadlib } from "@webhare/harescript";
import * as test from "@webhare/test-backend";

async function testLoadLib() {
  const lib = loadlib("mod::webhare_testsuite/tests/jssdk/harescript/data/invoketarget.whlib");
  await lib.CreateAndLeakJob();
}

test.runTests([testLoadLib,]);

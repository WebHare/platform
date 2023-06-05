import { allocateHSVM } from "@webhare/harescript";
import * as test from "@webhare/test";

async function testCalls() {
  const vm = await allocateHSVM();
  test.eq([17, 42, 999], await vm.callFunction("wh::util/algorithms.whlib#GetSortedSet", [42, 17, 999]));

  test.throws(/We're throwing it/, vm.callMacro("mod::webhare_testsuite/tests/system/nodejs/wasm/testwasmlib.whlib#ThrowIt"));
}

test.run([testCalls]);

import { allocateHSVM } from "@webhare/harescript";
import * as test from "@webhare/test";

async function testCalls() {
  const vm = await allocateHSVM();
  test.eq([17, 42, 999], await vm.call("wh::util/algorithms.whlib#GetSortedSet", [42, 17, 999]));
}

test.run([testCalls]);

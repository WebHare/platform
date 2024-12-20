import * as test from "@webhare/test";

async function testFail() {
  test.assert(Math.random() === 42);
}

test.runTests([testFail]);

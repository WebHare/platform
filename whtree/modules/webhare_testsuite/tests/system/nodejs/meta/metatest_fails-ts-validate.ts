import * as test from "@webhare/test";

async function testFail() {
  const x: string = 42;
  test.assert(true);
}

test.run([testFail]);

import { getCallStack, getCallerLocation } from "@mod-system/js/internal/util/stacktrace";
import * as test from "@webhare/test";

function testDeeperStack() {
  //as we only visually inspect these stacktraces and don't rely on parsing them yet, just check the source demapping
  const generat = getCallStack(0);
  test.eq([
    { filename: /test_stacktrace.ts$/, line: 6, col: 19, func: "testDeeperStack" },
    { filename: /test_stacktrace.ts$/, line: 14, col: 3, func: "testStackTrace" },
  ], generat.slice(0, 2));
}

function testStackTrace() {
  testDeeperStack();
  test.eq("testStackTrace", getCallerLocation(0).func);
}

test.run([testStackTrace]);

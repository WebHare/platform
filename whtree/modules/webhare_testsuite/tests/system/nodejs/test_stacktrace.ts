import { getCallerLocation, getCallStack } from "@mod-system/js/internal/util/stacktrace";
import * as test from "@webhare/test";


function testStackTrace() {
  const native = (new Error).stack;
  const generat = getCallStack(0);

  // Our code doesn't handle `Function.executeUserEntryPoint [as runMain]` correctly, returns executeUserEntryPoint
  const corrected_native = native!.replace(/Function\.executeUserEntryPoint[^(]*/, "executeUserEntryPoint ").replace("TracingChannel.traceSync", "traceSync");

  // correct generat[0] line number so it is the same as the position of 'new Error'
  --generat[0].line;

  test.eq(
    corrected_native.split(' at ').map(x => x.trim()).slice(1),
    generat.map((i, idx) => {
      const loc = `${i.filename}:${i.line}:${i.col}`;
      return i.func && i.func !== "unknown" ? `${i.func} (${loc})` : loc;
    }));

  // See if getCallerLocation(0) returns the correct caller function name
  const expect_funcname = corrected_native.split(' at ')[1].split(' ')[0];
  test.eq(expect_funcname, getCallerLocation(0).func);
}

test.run([testStackTrace]);

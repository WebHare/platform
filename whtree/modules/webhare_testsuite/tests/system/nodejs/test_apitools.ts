import * as test from "@webhare/test";
import * as apitools from "@webhare/js-api-tools";

function reallyThrowIt(addtrace?: apitools.StackTrace) {
  const err = new Error("We're throwing it");
  if (addtrace)
    apitools.prependStackTrace(err, addtrace);

  throw err;
}

function throwIt(addtrace?: apitools.StackTrace) {
  return reallyThrowIt(addtrace);
}

function reallyGetTrace() {
  return apitools.getStackTrace();
}

function getTrace() {
  return reallyGetTrace();
}

async function testApiTools() {
  const err = await test.throws(/We're throwing it/, throwIt);
  test.eqProps([
    { filename: /test_apitools.ts$/, func: "reallyThrowIt" },
    { filename: /test_apitools.ts$/, func: "throwIt" },
  ], apitools.parseTrace(err).slice(0, 2));

  const mytrace = getTrace().slice(0, 2);
  test.eqProps([
    { filename: /test_apitools.ts$/, func: "reallyGetTrace" },
    { filename: /test_apitools.ts$/, func: "getTrace" },
  ], mytrace);

  const err2 = await test.throws(/We're throwing it/, () => throwIt(mytrace));
  test.eqProps([
    { filename: /test_apitools.ts$/, func: "reallyGetTrace" },
    { filename: /test_apitools.ts$/, func: "getTrace" },
    { filename: /test_apitools.ts$/, func: "reallyThrowIt" },
    { filename: /test_apitools.ts$/, func: "throwIt" },
  ], apitools.parseTrace(err2).slice(0, 4));

}

test.run([testApiTools]);

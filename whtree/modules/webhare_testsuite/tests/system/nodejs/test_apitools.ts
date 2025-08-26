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
  test.eqPartial([
    { filename: /test_apitools.ts$/, func: "reallyThrowIt" },
    { filename: /test_apitools.ts$/, func: "throwIt" },
  ], apitools.parseTrace(err).slice(0, 2));

  const mytrace = getTrace().slice(0, 2);
  test.eqPartial([
    { filename: /test_apitools.ts$/, func: "reallyGetTrace" },
    { filename: /test_apitools.ts$/, func: "getTrace" },
  ], mytrace);

  const err2 = await test.throws(/We're throwing it/, () => throwIt(mytrace));
  test.eqPartial([
    { filename: /test_apitools.ts$/, func: "reallyGetTrace" },
    { filename: /test_apitools.ts$/, func: "getTrace" },
    { filename: /test_apitools.ts$/, func: "reallyThrowIt" },
    { filename: /test_apitools.ts$/, func: "throwIt" },
  ], apitools.parseTrace(err2).slice(0, 4));

}

async function testDidYouMean() {
  //Test from https://github.com/gustf/js-levenshtein/blob/master/test.js
  test.eq("a", apitools.getBestMatch("a", ["a"]));
  test.eq("b", apitools.getBestMatch("a", ["b"]));
  test.eq("testa", apitools.getBestMatch("test", ["testa", "texta"]));
  test.eq("TestA", apitools.getBestMatch("TEST", ["TestA", "TextA"]));
  test.eq("TestA", apitools.getBestMatch("TEST", ["TestA", "TESTAA", "TextA"]));
  test.eq("TESTaa", apitools.getBestMatch("TEST", ["TestA", "TESTaa", "TextA"], { matchCase: true }));

  test.eq("123", apitools.getBestMatch("12", ["123"]));
  test.eq(null, apitools.getBestMatch("12", ["1234"]));
  test.eq("12345", apitools.getBestMatch("123", ["12345"]));
  test.eq(null, apitools.getBestMatch("123", ["123456"]));

  test.eq(", did you mean '12345'?", apitools.addBestMatch("123", ["12345"]));
  test.eq("", apitools.addBestMatch("123", ["123456"]));

  test.typeAssert<test.Equals<apitools.PromisifyFunctionReturnType<() => number>, () => Promise<number>>>();
  test.typeAssert<test.Equals<apitools.PromisifyFunctionReturnType<() => Promise<number>>, () => Promise<number>>>();
}

test.runTests([
  testDidYouMean,
  testApiTools
]);

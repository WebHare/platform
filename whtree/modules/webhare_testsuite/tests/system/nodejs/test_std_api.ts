import * as test from "@webhare/test";
import * as std from "@webhare/std";
import testlist from "./test_std_tests";

function testBigInt() {
  //'Big integer literals are not available in the configured target environment ("es2016", "safari14")'
  //so we run these tests on nodejs only
  test.throws(/BigInt/, () => std.stringify({ a: { b: 42n } }, { stable: true }));
  test.eq(JSON.stringify({ a: { b: "42" } }), std.stringify({ a: { b: 42n } }, {
    stable: true,
    replacer: (k, v) => typeof v === "bigint" ? v.toString() : v
  }));
  test.eq(JSON.stringify({ a: { b: "42" } }, null, 2), std.stringify({ a: { b: 42n } }, {
    stable: true,
    replacer: (k, v) => typeof v === "bigint" ? v.toString() : v,
    space: 2
  }));
}

test.run([
  //test.run doesn't understand labels, sofilter those
  ...testlist.filter(_ => typeof _ !== 'string') as Array<() => Promise<void>>,
  testBigInt
]);

import { BoxedFloat, VariableType, determineType, getTypedArray } from "@mod-system/js/internal/whmanager/hsmarshalling";
import { allocateHSVM } from "@webhare/harescript";
import * as test from "@webhare/test";

function testTypeAPIs() {
  test.eq(VariableType.Float, determineType(new BoxedFloat(2.5)));
  test.eq(VariableType.Integer64Array, determineType([0, -1, 1, -2147483648, -2147483649, -2147483650, -9223372036854775807n, -9223372036854775808n, 9223372036854775807n]));
  test.eq(VariableType.Integer64Array, determineType(getTypedArray(VariableType.Integer64Array, [1n, 2n, 3n])));
}

async function testVarMemory() {

  const vm = await allocateHSVM();
  const arrayvar = vm.allocateVariable();
  const js_in64array = [0, -1, 1, -2147483648, -2147483649, -2147483650, -9223372036854775807n, -9223372036854775808n, 9223372036854775807n];
  arrayvar.setJSValue(js_in64array);
  test.eq(VariableType.Integer64Array, arrayvar.getType());
  test.eq(VariableType.Integer64, arrayvar.arrayGetRef(0)?.getType());
}

async function testCalls() {
  const vm = await allocateHSVM();
  test.eq([17, 42, 999], await vm.callFunction("wh::util/algorithms.whlib#GetSortedSet", [42, 17, 999]));

  test.throws(/We're throwing it/, vm.callMacro("mod::webhare_testsuite/tests/system/nodejs/wasm/testwasmlib.whlib#ThrowIt"));
}

test.run([
  testTypeAPIs,
  testVarMemory,
  testCalls
]);

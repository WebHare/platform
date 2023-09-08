import * as stacktrace_parser from "stacktrace-parser";
import { BoxedFloat, VariableType, determineType, getTypedArray } from "@mod-system/js/internal/whmanager/hsmarshalling";
import { HSVMObject, HareScriptMemoryBlob, allocateHSVM } from "@webhare/harescript";
import * as test from "@webhare/test";
import { beginWork, uploadBlob } from "@webhare/whdb";
import { lockMutex } from "@webhare/services";

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

  const binaryvar = vm.allocateVariable();
  binaryvar.setString("€");
  test.eq([0xE2, 0x82, 0xAC], [...binaryvar.getStringAsBuffer().values()]);
  binaryvar.setString(Buffer.from([0, 0x80]));
  // test.throws(/XX/, () => binaryvar.getString()); //not sure if it's worth the overhead to throw instead of ignore invalid UTF8 data, we'd have to continously run IsValidUTF8
  test.eq([0, 0x80], [...binaryvar.getStringAsBuffer().values()]);

  const blobvar = vm.allocateVariable();
  blobvar.setBlob(new HareScriptMemoryBlob);
  test.eq("", await blobvar.getBlob().text());

  blobvar.setBlob(new HareScriptMemoryBlob(Buffer.from("a blob!")));
  test.eq("a blob!", await blobvar.getBlob().text());

  /* Test empty blobs. Currently I'm assuming we will be needing type retention so getBlob should always be returning an object.
     It might be a better API to only have get(Boxing)JSValue do such trickery and have getFloat/getBlob return 'proper' JS values (ie numbers and null) */

  await beginWork();
  const blobvar1 = vm.allocateVariable(), blobvar2 = vm.allocateVariable();
  blobvar1.setDefault(VariableType.Blob);
  test.eq(0, blobvar1.getBlob().size, `confirm we're not getting nulls back after setting default`);
  blobvar1.setBlob(null);
  test.eq(0, blobvar1.getBlob().size, `confirm we're not getting nulls back after an explicit null`);

  const blob1 = await uploadBlob("This is blob 1");
  const blob2 = await uploadBlob("This is blob 2");
  test.assert(blob1 && blob2);
  blobvar1.setBlob(blob1);
  blobvar2.setJSValue(blob2);
  test.eq(VariableType.Blob, blobvar2.getType());

  const returnedblob1 = blobvar1.getBlob();
  test.eq(returnedblob1.size, blob1.size, "first a superficial check...");
  test.assert(blob1.isSameBlob(returnedblob1));

  const returnedblob2 = blobvar2.getBlob();
  test.eq(returnedblob2.size, blob2.size, "first a superficial check...");
  test.assert(blob2.isSameBlob(returnedblob2));

  vm.shutdown(); //let next test reuse it
}

async function testCalls() {
  const vm = await allocateHSVM();
  test.eq([17, 42, 999], await vm.call("wh::util/algorithms.whlib#GetSortedSet", [42, 17, 999]));
  const err = await test.throws(/We're throwing it/, vm.call("mod::webhare_testsuite/tests/system/nodejs/wasm/testwasmlib.whlib#ThrowIt"));
  const parsed = stacktrace_parser.parse(err.stack!);
  test.eqProps({ file: /testwasmlib\.whlib$/, methodName: "THROWIT" }, parsed[0]); //TODO we still return mod:: paths or should it just be a full path ?

  //test the VM is still operating after the throw:
  test.eq([17, 42, 999], await vm.call("wh::util/algorithms.whlib#GetSortedSet", [42, 17, 999]));

  //and if another throw works
  await test.throws(/We're throwing it/, vm.call("mod::webhare_testsuite/tests/system/nodejs/wasm/testwasmlib.whlib#ThrowIt"));
  test.eq([17, 42, 999], await vm.call("wh::util/algorithms.whlib#GetSortedSet", [42, 17, 999]));
}

async function testMutex() { //test the shutdown behavior of WASM HSVM mutexes
  const vm = await allocateHSVM();
  const hs_lockmgr = await vm.loadlib("mod::system/lib/services.whlib").openLockManager() as HSVMObject;
  const hs_mutex1lock = await hs_lockmgr.lockMutex("test:mutex1") as HSVMObject;
  const hs_mutex2lock = await hs_lockmgr.lockMutex("test:mutex2") as HSVMObject;
  test.assert(hs_mutex1lock);
  test.assert(hs_mutex2lock);

  //verify them being locked
  test.eq(null, await lockMutex("test:mutex1", { timeout: 0 }));
  test.eq(null, await lockMutex("test:mutex2", { timeout: 0 }));
  await hs_mutex1lock.release();

  let mutex = await test.wait(() => lockMutex("test:mutex1", { timeout: 0 }), "VM isn't actually releasing the lock");
  mutex.release();

  vm.shutdown();

  mutex = await test.wait(() => lockMutex("test:mutex2", { timeout: 0 }), "VM isn't properly shutting down, mutex is not being freed");
  mutex.release();

  //TODO ensure autorelease when the HSVM is abandoned and garbage collected
}


test.run([
  testTypeAPIs,
  testVarMemory,
  testCalls,
  testMutex
]);

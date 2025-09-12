import { CodeContext } from "@webhare/services/src/codecontexts";
import * as stacktrace_parser from "stacktrace-parser";
import { VariableType, getTypedArray } from "@mod-system/js/internal/whmanager/hsmarshalling";
import { type HSVMObject, createVM, loadlib, makeObject } from "@webhare/harescript";
import * as test from "@webhare/test";
import { beginWork, isSameUploadedBlob, uploadBlob } from "@webhare/whdb";
import { ResourceDescriptor, WebHareBlob, lockMutex } from "@webhare/services";
import { isInFreePool } from "@webhare/harescript/src/wasm-hsvm";
import { determineType } from "@webhare/hscompat/src/hson";

function testTypeAPIs() {
  test.eq(VariableType.Integer64Array, determineType([0, -1, 1, -2147483648, -2147483649, -2147483650, -9223372036854775807n, -9223372036854775808n, 9223372036854775807n]));
  test.eq(VariableType.Integer64Array, determineType(getTypedArray(VariableType.Integer64Array, [1n, 2n, 3n])));
}

async function testVarMemory() {
  const vmwrapper = await createVM();
  const vm = vmwrapper._getHSVM();
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
  blobvar.setBlob(WebHareBlob.from(""));
  test.eq("", await blobvar.getBlob().text());

  blobvar.setBlob(WebHareBlob.from("a blob!"));
  test.eq("a blob!", await blobvar.getBlob().text());

  const scratchvar = vm.allocateVariable();
  scratchvar.setJSValue(undefined);
  test.eq(VariableType.Record, scratchvar.getType());
  test.eq(false, scratchvar.recordExists());

  scratchvar.setJSValue([0, undefined, null, 3]);
  test.eq(VariableType.VariantArray, scratchvar.getType());
  test.eq(VariableType.Record, scratchvar.arrayGetRef(1)?.getType());

  scratchvar.setJSValue({ a: "xyz", b: undefined });
  test.eq(VariableType.Record, scratchvar.getType());
  test.assert(scratchvar.getCell("a"));
  test.assert(scratchvar.getCell("b") === null);

  scratchvar.setJSValue(Buffer.from("abc"));
  test.eq(VariableType.String, scratchvar.getType());
  test.eq("abc", scratchvar.getJSValue());

  const abuffer = new ArrayBuffer(3);
  const view = new Int8Array(abuffer);
  view.set([65, 98, 99]);
  scratchvar.setJSValue(abuffer);
  test.eq(VariableType.String, scratchvar.getType());
  test.eq("Abc", scratchvar.getJSValue());

  /* Test empty blobs. Currently I'm assuming we will be needing type retention so getBlob should always be returning an object.
     It might be a better API to only have get(Boxing)JSValue do such trickery and have getFloat/getBlob return 'proper' JS values (ie numbers and null) */

  await beginWork();
  const blobvar1 = vm.allocateVariable(), blobvar2 = vm.allocateVariable();
  blobvar1.setDefault(VariableType.Blob);
  test.eq(0, blobvar1.getBlob().size, `confirm we're not getting nulls back after setting default`);
  blobvar1.setBlob(null);
  test.eq(0, blobvar1.getBlob().size, `confirm we're not getting nulls back after an explicit null`);

  const blob1 = WebHareBlob.from("This is blob 1");
  const blob2 = WebHareBlob.from("This is blob 2");
  await uploadBlob(blob1);
  await uploadBlob(blob2);

  blobvar1.setBlob(blob1);
  blobvar2.setJSValue(blob2);
  test.eq(VariableType.Blob, blobvar2.getType());

  const returnedblob1 = blobvar1.getBlob();
  test.eq(returnedblob1.size, blob1.size, "first a superficial check...");
  test.assert(isSameUploadedBlob(blob1, returnedblob1));

  const returnedblob2 = blobvar2.getBlob();
  test.eq(returnedblob2.size, blob2.size, "first a superficial check...");
  test.assert(isSameUploadedBlob(blob2, returnedblob2));

  const __wasmmodule = vm.wasmmodule;
  await vmwrapper.dispose(); //let next test reuse it
  await test.wait(() => isInFreePool(__wasmmodule));
}

async function testCalls() {
  const vm = await createVM();

  test.eq([3, 1, 2], await vm.loadlib("mod::webhare_testsuite/tests/system/nodejs/wasm/testwasmlib.whlib").Echo([3, 1, 2]));
  test.eq(new Date("2024-01-01T12:13:14Z"), await vm.loadlib("mod::webhare_testsuite/tests/system/nodejs/wasm/testwasmlib.whlib").Echo(Temporal.Instant.from("2024-01-01T12:13:14Z")));
  test.eq(new Date("2024-01-01T11:13:14Z"), await vm.loadlib("mod::webhare_testsuite/tests/system/nodejs/wasm/testwasmlib.whlib").Echo(Temporal.ZonedDateTime.from("2024-01-01T12:13:14[Europe/Amsterdam]")));
  test.eq(new Date("2024-01-01T00:00:00Z"), await vm.loadlib("mod::webhare_testsuite/tests/system/nodejs/wasm/testwasmlib.whlib").Echo(Temporal.PlainDate.from("2024-01-01")));
  test.eq(new Date("2024-01-01T12:13:14Z"), await vm.loadlib("mod::webhare_testsuite/tests/system/nodejs/wasm/testwasmlib.whlib").Echo(Temporal.PlainDateTime.from("2024-01-01T12:13:14")));

  test.eq([17, 42, 999], await vm.loadlib("wh::util/algorithms.whlib").GetSortedSet([42, 17, 999]));
  const err = await test.throws(/We're throwing it/, vm.loadlib("mod::webhare_testsuite/tests/system/nodejs/wasm/testwasmlib.whlib").ThrowIt());
  const parsed = stacktrace_parser.parse(err.stack!);
  test.eqPartial({ file: /testwasmlib\.whlib$/, methodName: "THROWIT" }, parsed[0]); //TODO we still return mod:: paths or should it just be a full path ?

  //test the VM is still operating after the throw:
  test.eq([17, 42, 999], await vm.loadlib("wh::util/algorithms.whlib").GetSortedSet([42, 17, 999]));

  //and if another throw works
  await test.throws(/We're throwing it/, vm.loadlib("mod::webhare_testsuite/tests/system/nodejs/wasm/testwasmlib.whlib").ThrowIt());
  test.eq([17, 42, 999], await vm.loadlib("wh::util/algorithms.whlib").GetSortedSet([42, 17, 999]));

  //verify promises
  test.eq(15, await vm.loadlib("wh::promise.whlib").createSleepPromise(15));
  await test.throws(/We're async throwing it/, vm.loadlib("mod::webhare_testsuite/tests/system/nodejs/wasm/testwasmlib.whlib").ThrowItAsync());

  //verify makeObject
  const exc = await makeObject("wh::system.whlib#Exception", "This is a test exception", null); //TODO honor default parameters? but apparently MakeObject doesn't do it either
  test.eq("This is a test exception", await exc.$get("what"));
  test.eq(true, await loadlib("wh::system.whlib").ObjectExists(exc));
  await exc.$set("what", "Change the exception");
  test.eq("Change the exception", await exc.$get("what"));

  const testobjVM = await createVM();
  const testobj = await testobjVM.makeObject("mod::webhare_testsuite/tests/system/nodejs/wasm/testwasmlib.whlib#testobj");
  await testobj.$set("prop", "ok");
  test.eq("ok", await testobj.$get("prop"));

  //TODO test that HS exception trace is stitched into the JS stacktrace
  await test.throws(/Throwing/, () => testobj.$set("prop", "throw"));

  //Try to run normal code
  await testobj.$set("prop", "ok2");
  test.eq("ok2", await testobj.$get("prop"));

  await test.throws(/Unexpected value 'boem'/, () => testobj.$set("prop", "boem"));
  await test.throws(/Unexpected value 'boem'/, testobjVM.done);

  //test whether we can keep values boxed
  const rawvm = vm._getHSVM();
  using param = rawvm.allocateVariable();
  using retval = rawvm.allocateVariable();
  param.setString("wh::util/algorithms.whlib#GetSortedSet");
  test.eq(true, await rawvm.callWithHSVMVars("wh::system.whlib#MakeFunctionPtr", [param], undefined, retval));
  test.eq([1, 2, 3], await vm.loadlib("wh::system.whlib").CallAnyPtrVA(retval, [[3, 1, 2]]));

  //test whether a ResourceDescriptor properly transforms into a WrappedBlob on the HS Side
  const goldfish = await ResourceDescriptor.fromResource("mod::system/web/tests/goudvis.png", { getHash: true, getDominantColor: true, getImageMetadata: true });
  test.eqPartial({
    mimetype: 'image/png',
    width: 385,
    height: 236,
    rotation: 0,
    mirrored: false,
    refpoint: null,
    dominantcolor: '#080808',
    hash: 'aO16Z_3lvnP2CfebK-8DUPpm-1Va6ppSF0RtPPctxUY',
    extension: '.png',
    __blobsource: '',
    filename: 'goudvis.png',
    source_fsobject: 0
  }, await loadlib("mod::system/whlibs/internal/filetypes.whlib").ValidateWrappedData(goldfish));
}

async function testVMAbort() {
  const vm1 = await createVM();
  await test.throws(/We're aborting it/, vm1.loadlib("mod::webhare_testsuite/tests/system/nodejs/wasm/testwasmlib.whlib").AbortIt());
  await test.throws(/VM .*is shutting down or has aborted/, vm1.loadlib("mod::webhare_testsuite/tests/system/nodejs/wasm/testwasmlib.whlib").Echo("Hi"));

  await test.sleep(50); //this give any uncaught rejections time to come forward (eg if createVM wasn't discarding the exception frmo executeScript)

  const vm2 = await createVM();
  await test.throws(/We're async aborting it/, vm2.loadlib("mod::webhare_testsuite/tests/system/nodejs/wasm/testwasmlib.whlib").AbortItAsync());
  await test.throws(/VM .* has already shut down/, vm1.loadlib("mod::webhare_testsuite/tests/system/nodejs/wasm/testwasmlib.whlib").Echo("Hi"));

  await test.sleep(50); //this give any uncaught rejections time to come forward (eg if createVM wasn't discarding the exception frmo executeScript)
}

async function testMutex() { //test the shutdown behavior of WASM HSVM mutexes
  const vm = await createVM();
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

  const disposer = vm.dispose();

  mutex = await test.wait(() => lockMutex("test:mutex2", { timeout: 0 }), "VM isn't properly shutting down, mutex is not being freed");
  mutex.release();

  await disposer;

  //TODO ensure autorelease when the HSVM is abandoned and garbage collected
}


async function testLingeringContext() {
  const lingering = new CodeContext("lingering", {});
  test.eq(42, lingering.run(() => 42));
  test.eq([17, 42, 999], await lingering.run(async () => await loadlib("wh::util/algorithms.whlib").GetSortedSet([42, 17, 999])));
}

async function testMethodCalls() {
  await using vm = await createVM();

  await test.throws(/We're async throwing it/, vm.loadlib("mod::webhare_testsuite/tests/system/nodejs/wasm/testwasmlib.whlib").ThrowItAsync());

  const testobj = await vm.makeObject("mod::webhare_testsuite/tests/system/nodejs/wasm/testwasmlib.whlib#TestCallObj");
  test.eq(1, await testobj.$invoke("method_func", [1]));
  await test.throws(/throw/, async () => await testobj.$invoke("method_func", [2]));
  test.eq(undefined, await testobj.$invoke("method_macr", [1]));
  await test.throws(/throw/, async () => await testobj.$invoke("method_macr", [2]));

  test.eq(1, await testobj.$invoke("member_func", [1]));
  await test.throws(/throw/, async () => await testobj.$invoke("member_func", [2]));
  test.eq(undefined, await testobj.$invoke("member_macr", [1]));
  await test.throws(/throw/, async () => await testobj.$invoke("member_macr", [2]));

  test.eq(1, await testobj.$invoke("property_func", [1]));
  await test.throws(/throw/, async () => await testobj.$invoke("property_func", [2]));
  test.eq(undefined, await testobj.$invoke("property_macr", [1]));
  await test.throws(/throw/, async () => await testobj.$invoke("property_macr", [2]));

  test.eq(1, await testobj.$invoke("^hat_func", [1]));
  await test.throws(/throw/, async () => await testobj.$invoke("^hat_func", [2]));
  test.eq(undefined, await testobj.$invoke("^hat_macr", [1]));
  await test.throws(/throw/, async () => await testobj.$invoke("^hat_macr", [2]));
}

test.runTests([
  testTypeAPIs,
  testVarMemory,
  testCalls,
  testVMAbort,
  testMethodCalls,
  testMutex,
  testLingeringContext
]);

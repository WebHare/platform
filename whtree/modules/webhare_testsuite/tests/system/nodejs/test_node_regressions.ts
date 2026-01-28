import * as test from "@webhare/test-backend";
import { execFileSync } from "node:child_process";
import { AsyncLocalStorage } from "node:async_hooks";

async function testWasmSpawn() {
  /* tests that execFileSync works when using JSPI (that uses stack switching internally)
     Node code also ran in an alternative stack, that was allocated as MADV_DONTFORK by v8.
     The missing stack then casused a crash after fork()
  */

  const nodeMajor = parseInt(process.env["WEBHARE_NODE_MAJOR"] || "NaN");
  if (Number.isNaN(nodeMajor))
    throw new Error(`WEBHARE_NODE_MAJOR not properly set`); //not using process.version as then we're not under WebHare build control

  function testExecSync(location: string) {
    console.log(`run testExecSync - ${location}`);
    const output = execFileSync(`node`, [`-e`, `console.log("ok");`]).toString();
    if (output !== "ok\n")
      throw new Error(`execFileSync failed, output should be "ok\n", but was ${JSON.stringify(output)}`);
  }

  async function runTest() {
    testExecSync("main script, before wasm");

    const js_import = nodeMajor === 22 ?
      // @ts-ignore -- WebAssembly.Function is not yet spec (node 22)
      new WebAssembly.Function({
        parameters: ['externref', 'i32'],
        results: ['i32']
      },
        (v: number) => { return Promise.resolve(v); },
        { suspending: 'first' }) :
      // @ts-ignore -- WebAssembly.Suspending is not yet spec (node 23+)
      new WebAssembly.Suspending((v: number) => { return Promise.resolve(v); },);

    /* built a module using the WasmModuleBuilder from the v8 source code, used code from test TestStackSwitchGC2
        from test test/mjsunit/wasm/stack-switching.js
    let sig = makeSig([kWasmExternRef, kWasmI32], [kWasmI32]);
    let builder = new WasmModuleBuilder();
    let import_index = builder.addImport('m', 'import', sig);
    builder.addFunction("test", sig)
        .addBody([
            kExprLocalGet, 0,
            kExprLocalGet, 1,
            kExprCallFunction, import_index,
        ]).exportFunc();
    console.log(builder.toBuffer());
    */
    const moduleBuffer = new Uint8Array([
      0, 97, 115, 109, 1, 0, 0, 0, 1, 13, 2, 96,
      2, 111, 127, 1, 127, 96, 2, 111, 127, 1, 127, 2,
      12, 1, 1, 109, 6, 105, 109, 112, 111, 114, 116, 0,
      0, 3, 2, 1, 1, 7, 8, 1, 4, 116, 101, 115,
      116, 0, 1, 10, 10, 1, 8, 0, 32, 0, 32, 1,
      16, 0, 11, 0, 14, 4, 110, 97, 109, 101, 1, 7,
      1, 1, 4, 116, 101, 115, 116
    ]);
    const module = new WebAssembly.Module(moduleBuffer);
    const instance = new WebAssembly.Instance(module, { 'm': { 'import': js_import } });

    const wrapper = nodeMajor === 22 ?
      // @ts-ignore -- WebAssembly.Function is not yet spec (node 22)
      new WebAssembly.Function({
        parameters: ["i32"],
        results: ["externref"]
      }, instance.exports.test, { promising: 'first' }) :
      // @ts-ignore -- WebAssembly.promising is not yet spec (node 23+)
      WebAssembly.promising(instance.exports.test);

    const arg = { valueOf: () => { testExecSync("within wasm"); return 24; } };

    const v1 = wrapper(arg);
    testExecSync("after suspending call");
    console.log(await v1);
  }

  await runTest();
}

/* Tests that the AsyncLocalStore store is retained when WASM resumes
   after calling a JS function that returns a promise.
   Currently, the commandline switch `--experimental-wasm-stack-switching` is
   needed to run this code.
*/

async function testAsyncContextLoss() {
  const nodeMajor = parseInt(process.env["WEBHARE_NODE_MAJOR"] || "NaN");
  if (Number.isNaN(nodeMajor))
    throw new Error(`WEBHARE_NODE_MAJOR not properly set`); //not using process.version as then we're not under WebHare build control

  /* This test fails in node 22 and 23 (last tested 2024-12-03). If this works again,
     the fix-emcc-output.js fixes for keeping the async context can be removed.
     Test again at node 24.
  */
  if (nodeMajor < 24) {
    console.error(`Node version ${nodeMajor} too low (want 24+), skipping test 'testAsyncContextLoss'`);
    return;
  }

  /* The following code calls the import `m.import` twice, and returns the
     value returned by the second call.

     Test adapted from test TestStackSwitchGC2 from v8 test test/mjsunit/wasm/stack-switching.js

     Steps to generate the module bytecode
     - make a copy of the file /deps/v8/test/mjsunit/wasm/wasm-module-builder.js
     - append the following code
      ```
      let sig = makeSig([kWasmExternRef], [kWasmI32]);
      let builder = new WasmModuleBuilder();
      let import_index = builder.addImport('m', 'import', sig);
      builder.addFunction("test", sig)
          .addBody([
              kExprLocalGet, 0,
              kExprCallFunction, import_index,
              kExprDrop,
              kExprLocalGet, 0,
              kExprCallFunction, import_index,
          ]).exportFunc();
      console.log(builder.toBuffer());
      ```
     - run using node, copy the bytes in the following array
  */

  const wasmModuleBinaryData = new Uint8Array([
    0, 97, 115, 109, 1, 0, 0, 0, 1, 11, 2, 96,
    1, 111, 1, 127, 96, 1, 111, 1, 127, 2, 12, 1,
    1, 109, 6, 105, 109, 112, 111, 114, 116, 0, 0, 3,
    2, 1, 1, 7, 8, 1, 4, 116, 101, 115, 116, 0,
    1, 10, 13, 1, 11, 0, 32, 0, 16, 0, 26, 32,
    0, 16, 0, 11, 0, 14, 4, 110, 97, 109, 101, 1,
    7, 1, 1, 4, 116, 101, 115, 116
  ]);

  const als = new AsyncLocalStorage<{ id: number }>;

  // Imported asynchronous function, returns the .id value of the data stored in `als`
  // @ts-ignore -- WebAssembly.Suspending is not spec, but exists in node 23
  const jsImport = new WebAssembly.Suspending(() => {
    console.log(`AsyncLocalStorage store called from wasm: ` + JSON.stringify(als.getStore()));
    return Promise.resolve(als.getStore()?.id ?? 0);
  });

  const wasmModule = new WebAssembly.Module(wasmModuleBinaryData);
  const wasmInstance = new WebAssembly.Instance(wasmModule, { 'm': { 'import': jsImport } });

  // @ts-ignore -- WebAssembly.promising is not spec, but exists in node 23
  const exportWrapper = WebAssembly.promising(wasmInstance.exports.test);

  const retval = await als.run({ id: 1 }, () => exportWrapper());
  if (retval !== 1)
    throw new Error(`Lost the AsyncLocalStorage context, got ${retval}`);
}

function testTextDecoder() {
  // https://github.com/nodejs/node/issues/56542
  const decoded = new TextDecoder("Windows-1252").decode(new Uint8Array([146])).charCodeAt(0);
  test.eq(8217, decoded);
}

function testBufferOptimize() {
  // https://github.com/nodejs/node/issues/54521
  for (let i = 0; i < 100_000; ++i) {
    const asHex = Buffer.from("\x80").toString("hex");
    test.eq("c280", asHex, `Failed after ${i}th iteration`);
  }
}

test.runTests([
  testWasmSpawn,
  testAsyncContextLoss,
  testTextDecoder,
  testBufferOptimize,
]);

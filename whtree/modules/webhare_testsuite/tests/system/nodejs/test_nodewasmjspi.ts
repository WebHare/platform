import { execFileSync } from "node:child_process";

/* tests that execFileSync works when using JSPI (that uses stack switching internally)
   Node code also ran in an alternative stack, that was allocated as MADV_DONTFORK by v8.
   The missing stack then casused a crash after fork()
*/

function testExecSync(location: string) {
  console.log(`run testExecSync - ${location}`);
  const output = execFileSync(`node`, [`-e`, `console.log("ok");`]).toString();
  if (output !== "ok\n")
    throw new Error(`execFileSync failed, output should be "ok\n", but was ${JSON.stringify(output)}`);
}

async function test() {
  testExecSync("main script, before wasm");

  // @ts-ignore -- WebAssembly.Function is not yet spec
  const js_import = new WebAssembly.Function({
    parameters: ['externref', 'i32'],
    results: ['i32']
  },
    (v: number) => { return Promise.resolve(v); },
    { suspending: 'first' });

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

  // @ts-ignore -- WebAssembly.Function is not yet spec
  const wrapper = new WebAssembly.Function({
    parameters: ["i32"],
    results: ["externref"]
  }, instance.exports.test, { promising: 'first' });

  const arg = { valueOf: () => { testExecSync("within wasm"); return 24; } };

  const v1 = wrapper(arg);
  testExecSync("after suspending call");
  console.log(await v1);
}

void test();

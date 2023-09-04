
import { allocateHSVM } from "@webhare/harescript";
import bridge from "@mod-system/js/internal/whmanager/bridge";
import * as test from "@webhare/test";


let output = "";


async function runSingleEventHandler(id: number) {
  const vm = await allocateHSVM();

  const out = (opaqueptr: number, numbytes: number, data: number, allow_partial: number, error_result: number): number => {
    output += Buffer.from(vm.wasmmodule.HEAP8.slice(data, data + numbytes)).toString();
    return numbytes;
  };
  const outputfunction = vm.wasmmodule.addFunction(out, "iiiiii");
  vm.wasmmodule._HSVM_SetOutputCallback(vm.hsvm, 0, outputfunction);

  vm.consoleArguments = [`${id}`];
  await new Promise(r => setTimeout(r, 500));

  await vm.loadlib(`mod::webhare_testsuite/tests/system/nodejs/wasm/testwasmlib.whlib`).RunWASMEventTestHandler();
  await bridge.ensureDataSent();
}

async function testWasmEventIntegration() {
  const vms = 4;

  const promises = new Array<Promise<void>>;
  for (let v = 0; v < vms; ++v)
    promises.push(runSingleEventHandler(v));

  await Promise.all(promises);

  let expected = "";
  for (let v = 0; v < vms; ++v) {
    expected += `${v}: final events: ${vms}\n`;
    for (let v2 = 0; v2 < vms; ++v2) {
      expected += `${v}: ipc-test.${v2}\n`;
    }
  }

  test.eq(expected.trim(), output.split("\n").sort().join("\n").trim());
}

test.run([testWasmEventIntegration]);

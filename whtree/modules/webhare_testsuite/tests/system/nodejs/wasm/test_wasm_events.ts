import bridge, { IPCLinkType } from "@mod-system/js/internal/whmanager/bridge";
import * as test from "@webhare/test";
import { createDeferred } from "@webhare/std";
import { createVM } from "@webhare/harescript/src/machinewrapper";


let output = "";

async function runSingleEventHandler(id: number) {
  const vmwrapper = await createVM({ consoleArguments: [`${id}`] });
  const vm = vmwrapper._getHSVM();
  vm.captureOutput(out => output += Buffer.from(out).toString());
  await new Promise(r => setTimeout(r, 500));

  await vmwrapper.loadlib(`mod::webhare_testsuite/tests/system/nodejs/wasm/testwasmlib.whlib`).RunWASMEventTestHandler();
  await bridge.ensureDataSent();
}

async function testWasmEventIntegration() {
  const vms = 4;

  type Link = IPCLinkType<{ type: "register"; id: string }, { type: "continue" }>;
  const port = bridge.createPort<Link>("local:registration", { global: false });
  const registered = new Array<string>;
  const allRegistered = createDeferred<void>();
  port.on("accept", async link => {
    link.on("message", async packet => {
      if (packet.message.type === "register") {
        registered.push(packet.message.id);
        if (registered.length === vms)
          allRegistered.resolve();
        await allRegistered.promise;
        link.send({ type: "continue" }, packet.msgid);
        link.close();
      } else
        console.log(`unknown message`, packet);
    });
    await link.activate();
  });
  await port.activate();
  allRegistered.promise.then(() => port.close());

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

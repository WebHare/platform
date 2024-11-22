import { runScript } from "./machinewrapper";
import bridge from "@mod-system/js/internal/whmanager/bridge";

async function test() {
  try {
    const vm = await runScript(process.argv[2], { consoleArguments: process.argv.slice(3) });
    await vm.done;
  } finally {
    await bridge.ensureDataSent();
  }
}

void test();

import { allocateHSVM } from "./wasm-hsvm";
import bridge from "@mod-system/js/internal/whmanager/bridge";

async function test() {
  try {
    const vm = await allocateHSVM();
    await vm.run(process.argv[2]);
    vm.shutdown();
  } finally {
    await bridge.ensureDataSent();
  }
}

test();

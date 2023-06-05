import { allocateHSVM } from "./wasm-hsvm";

async function test() {
  const vm = await allocateHSVM();
  await vm.run(process.argv[2]);
}

test();

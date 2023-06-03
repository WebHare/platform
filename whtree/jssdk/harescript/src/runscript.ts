import { allocateHSVM } from "./wasm-hsvm";

async function test() {

  // const myfile = fs.readFileSync("/tmp/_1/test.xml");

  const vm = await allocateHSVM();
  // const retval = await vm.call("direct::/Users/rob/projects/whdata/main/root/target.whlib#EdudexValidateXSD", myfile, "program");
  if (process.argv[2].includes('#')) {
    const retval = await vm.call(process.argv[2]);
    console.log({ retval });
  } else {
    await vm.run(process.argv[2]);
  }
}

test();

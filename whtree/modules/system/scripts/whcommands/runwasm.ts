import * as path from "node:path";
import { allocateHSVM } from "@webhare/harescript";
import { toResourcePath } from "@webhare/services";

async function runWasmScript(script: string, params: string[]) {
  script = toResourcePath(script, { allowUnmatched: true }) || `direct::${path.isAbsolute(script) ? script : path.join(process.cwd(), script)}`;

  const vm = await allocateHSVM();
  vm.consoleArguments = params;
  await vm.run(script);
}

if (process.argv.length < 2) {
  console.error(`Missing script name`);
  process.exit(1);
}

runWasmScript(process.argv[2], process.argv.slice(3));

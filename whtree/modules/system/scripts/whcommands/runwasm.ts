import * as path from "node:path";
import { allocateHSVM } from "@webhare/harescript";
import { toResourcePath } from "@webhare/services";
import bridge from "@mod-system/js/internal/whmanager/bridge";

async function runWasmScript(script: string, params: string[]) {
  if (!script.startsWith("mod::"))
    script = toResourcePath(script, { allowUnmatched: true }) || `direct::${path.isAbsolute(script) ? script : path.join(process.cwd(), script)}`;

  try {
    const vm = await allocateHSVM({ script, consoleArguments: params });
    await vm.done;
  } finally {
    await bridge.ensureDataSent();
  }
}

if (process.argv.length < 2) {
  console.error(`Missing script name`);
  process.exit(1);
}

runWasmScript(process.argv[2], process.argv.slice(3));

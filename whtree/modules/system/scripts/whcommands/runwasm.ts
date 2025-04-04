import * as path from "node:path";
import { toResourcePath } from "@webhare/services";
import bridge from "@mod-system/js/internal/whmanager/bridge";
import { runScript } from "@webhare/harescript/src/machinewrapper";
import { HSVMSymbol } from "@webhare/harescript/src/wasm-support";
import { setScopedResource } from "@webhare/services/src/codecontexts";

async function runWasmScript(script: string, params: string[]) {
  if (!script.startsWith("mod::"))
    script = toResourcePath(script, { allowUnmatched: true }) || `direct::${path.isAbsolute(script) ? script : path.join(process.cwd(), script)}`;

  try {
    const vm = await runScript(script, { consoleArguments: params });
    setScopedResource(HSVMSymbol, vm); //ensure any loadlib stays in the script's context
    await vm.done;
    process.exitCode = vm.vm?.deref()?.exitCode ?? 254;
  } finally {
    await bridge.ensureDataSent();
  }
}

if (process.argv.length < 2) {
  console.error(`Missing script name`);
  process.exit(1);
}

void runWasmScript(process.argv[2], process.argv.slice(3));

import { runCli } from "@webhare/cli";
import { runScript } from "@webhare/harescript";
import { setScopedResource } from "@webhare/services/src/codecontexts";
import { HSVMSymbol } from "@webhare/harescript/src/wasm-support";
import { debugFlags } from "@webhare/env";
import { spawnSync } from "child_process";
import { backendConfig, broadcast, logDebug } from "@webhare/services";
import { existsSync } from "node:fs";
import { storeDiskFile } from "@webhare/system-tools";

let verbose = debugFlags["startup"];

//Run the original HS code until we've migrated it all
async function poststartHS() {
  if (verbose) {
    console.log(`Starting post-start.whscr`);
    console.time("post-start.whscr");
  }

  const vm = await runScript("mod::system/scripts/internal/post-start.whscr");
  setScopedResource(HSVMSymbol, vm); //ensure any calljs->loadlib executed during post-start stays in the script's context
  await vm.done;

  const returncode = vm.vm?.deref()?.exitCode ?? 254;
  if (returncode)
    throw new Error(`Startup script exited with code ${returncode}`);

  if (verbose) {
    console.timeEnd("post-start.whscr");
  }
}

//Invoke WEBHARE_POSTSTARTSCRIPT
async function runPostStartScripts() {
  const startupscript = process.env.WEBHARE_POSTSTARTSCRIPT;
  if (startupscript) {
    if (verbose)
      console.log("Running post-start script: " + startupscript);

    const proc = spawnSync(startupscript, [], { encoding: "utf-8", stdio: 'inherit' });
    if (proc.status !== 0)
      console.log(`Post-start script ${startupscript} exited with code ${proc.status}`);
  }
}

runCli({
  flags: {
    "v,verbose": { description: "Enable verbose logging" },
  }, async main({ opts }) {
    verbose ||= opts.verbose;

    const start = Date.now();
    const serviceStateFile = `${backendConfig.dataRoot}caches/platform/run/servicestate.poststartdone.json`;
    //first post-start of this session? (servicestate is cleared between service startups) (TODO servicemanager could just tell us this too)
    const isFirstPostStart = !existsSync(serviceStateFile);

    if (!debugFlags["db-readonly"]) {
      logDebug("system:poststart", { state: "starting", isFirstPostStart, message: "Database is writable, start preparing" });

      await poststartHS();
      await runPostStartScripts();

      const elapsed = Date.now() - start;
      logDebug("system:poststart", { state: "finished", isFirstPostStart, startuptime: elapsed });

      if (isFirstPostStart)
        console.log(`All post start tasks completed, ${(elapsed / 1000).toFixed(3)} seconds from launch`);
    }

    // Update startup state info
    await storeDiskFile(serviceStateFile, `{}`, { overwrite: true });
    broadcast(`system:internal.servicestate.poststartdone`);
  }
});

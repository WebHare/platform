/* We wrap webhareservice-startup.whscr so we can ensure configuration files are in place - eg the siteprofile
   compiler depends on the assetpack extract (and similar issues will puop up in the future)

   Ideally we would slowly subsume all that webhareservice-startup.whscr does but be a bit more parallel as we
   are a startup blocker (we block servicemanager from going to Online)
*/

import { updateGeneratedFiles } from "@mod-system/js/internal/generation/generator";
import { debugFlags } from "@webhare/env";
import { backendConfig } from "@webhare/services";
import { spawn } from "node:child_process";

async function main() {
  const verbose = debugFlags.startup;

  /* The wh script will have generated 'config' already (TODO consider doing it here but then C++ processes might
     ignore or race before they recognize installed modules. Which might be for the better for a fast startup)

     This step is an unavoidable XML parse */
  try {
    await updateGeneratedFiles(["extract"], { verbose });
  } catch (e) {
    //this shouldn't happen, the parsers need to be robust. but we shouldn't be shutting down WebHare either
    console.error("ERROR running updateGeneratedFiles", e);
  }

  /* Run the OG startup script */
  const startupper = spawn(
    backendConfig.installationroot + "bin/runscript",
    ["--workerthreads", "4", "mod::system/scripts/internal/webhareservice-startup.whscr"],
    { stdio: "inherit" });

  const returncode = await new Promise<{ code: number; signal: string }>(resolve => startupper.on("exit", resolve));
  if (returncode.code || returncode.signal) {
    if (returncode.code)
      console.error(`Startup script exited with code ${returncode.code}`);
    else if (returncode.signal)
      console.error(`Startup script exited with signal ${returncode.signal}`);

    process.exitCode = 1;
  }
}

void main();

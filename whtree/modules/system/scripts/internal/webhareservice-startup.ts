/* We wrap webhareservice-startup.whscr so we can ensure configuration files are in place - eg the siteprofile
   compiler depends on the assetpack extract (and similar issues will puop up in the future)

   Ideally we would slowly subsume all that webhareservice-startup.whscr does but be a bit more parallel as we
   are a startup blocker (we block servicemanager from going to Online)
*/

import { updateGeneratedFiles } from "@mod-system/js/internal/generation/generator";
import { run } from "@webhare/cli";
import { debugFlags } from "@webhare/env";
import { runScript } from "@webhare/harescript";
import { HSVMSymbol } from "@webhare/harescript/src/wasm-support";
import { setScopedResource } from "@webhare/services/src/codecontexts";
import { sleep } from "@webhare/std";
import { bootstrapPostgresWHDB } from "@webhare/whdb/src/bootstrap";
import { __createRawConnection } from "@webhare/whdb/src/impl";

let verbose = debugFlags.startup;

/* things we can do without a database in a TS-only environment (HareScript may not be available) */
async function preDatabaseBootstrapTS() {
  /* The wh script will have generated 'config' already (TODO consider doing it here but then C++ processes might
     ignore or race before they recognize installed modules. Which might be for the better for a fast startup)
*/
  try {
    await updateGeneratedFiles(["extracts"], { verbose });
  } catch (e) {
    //this shouldn't happen, the parsers need to be robust. but we shouldn't be shutting down WebHare either
    console.error("ERROR running updateGeneratedFiles", e);
  }
}

/* Bring the PG database to a usable state */
async function bootstrapDatabase() {
  // Get a connection. We race postgres' startup so we need to loop on connection
  const startWait = Date.now();
  let firstTry = true;
  let pgclient;
  for (; ;) {
    try {
      pgclient = await __createRawConnection();
      break;
    } catch (e) {
      await sleep(50);
      firstTry = false;
    }
  }

  if (verbose && !firstTry) {
    const elapsed = Date.now() - startWait;
    console.log(`Waited ${elapsed}ms for database to be available`);
  }

  /* Bootstrap postgres. This creates the webhare_internal.blob type without which @webhare/whdb can't even properly connect! */
  await bootstrapPostgresWHDB(pgclient);
  await pgclient.close();
}

async function runStep(name: string, fn: () => Promise<void>) {
  if (verbose) {
    console.log(`Starting ${name}`);
    console.time(name);
  }

  try {
    await fn();
  } catch (e) {
    console.error(`Error running step ${name}:`, e);
    throw e;
  }
  if (verbose) {
    console.timeEnd(name);
  }
}

async function startupHS() {
  if (verbose) {
    console.log(`Starting webhareservice-startup.whscr`);
    console.time("webhareservice-startup.whscr");
  }

  const vm = await runScript("mod::system/scripts/internal/webhareservice-startup.whscr");
  setScopedResource(HSVMSymbol, vm); //ensure any loadlib stays in the srcipt's context
  await vm.done;

  const returncode = vm.vm?.deref()?.exitCode ?? 254;
  if (returncode)
    throw new Error(`Startup script exited with code ${returncode}`);

  if (verbose) {
    console.timeEnd("webhareservice-startup.whscr");
  }
}

run({
  flags: {
    "v,verbose": { description: "Enable verbose logging" },
  }, async main({ opts }) {
    verbose ||= opts.verbose;
    await runStep("updateGeneratedFiles", async () => preDatabaseBootstrapTS());
    await runStep("bootstrapDatabase", async () => bootstrapDatabase());

    await runStep("startupHS", async () => startupHS());
  }
});

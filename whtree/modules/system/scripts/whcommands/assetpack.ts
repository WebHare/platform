// @webhare/cli: Manage asset packs

import { loadAssetPacksConfig } from '@mod-platform/js/assetpacks/api';
import type { AssetPackMiniStatus } from '@mod-platform/js/devsupport/devbridge';
import { logValidationMessagesToConsole } from '@mod-platform/js/devsupport/messages';
import { openBackendService, subscribe, writeRegistryKey, type BackendEvents, type GetBackendServiceInterface } from '@webhare/services';
import { regExpFromWildcards, sleep } from '@webhare/std';
import { runInWork } from '@webhare/whdb';
import { ansiCmd, enumOption, run } from '@webhare/cli';
import { getExtractedConfig } from '@mod-system/js/internal/configuration';
import { readBundleSettings } from '@mod-platform/js/assetpacks/support';
import { buildRecompileSettings, recompile } from '@mod-platform/js/assetpacks/compiletask';

let client: Promise<GetBackendServiceInterface<"platform:assetpacks">> | undefined;

const assetPackOption = {
  parseValue: (arg: string) => arg,
  autoComplete: (mask: string) => {
    //first complete to module name, then to the full name
    const allpacks = getExtractedConfig("assetpacks").map(assetpack => assetpack.name);
    return mask.includes(':') ? allpacks : [...new Set(allpacks.map(name => name.split(':')[0] + ':*'))];
  }
};

const argv = process.argv.slice(2).map(arg => {
  if (arg === "recompile") {
    //TODO once live_api has switched to wh compile, we can drop this hidden alias
    console.warn("You should switch to 'wh assetpack compile' in WH5.7+");
    return "compile";
  }
  return arg;
});

const runData = run({
  flags: {
    quiet: { default: false, description: "Don't report anything that's not an error" },
    "allow-missing": { default: false, description: "Do not fail if the masks don't match any package" },
  },
  subCommands: {
    list: {
      description: "List asset packs",
      arguments: [{ name: "[assetpacks...]", description: "Asset packs to list" }],
      flags: {
        withwatchcounts: { default: false, description: "Show watch counts" },
        watch: { default: false, description: "Watch asset packs" },
      },
      async main({ args: { assetpacks }, opts: options }) {
        if (!options.watch) {
          await listBundles(assetpacks, options.withwatchcounts);
        } else {
          for (; ;) {
            setTimeout(() => { }, 86400 * 1000); //keep the process alive
            const waiter = waitForEvent("platform:assetpackcontrol.update");
            console.log(`${ansiCmd("erasedisplay", { pos: { x: 2, y: 2 } })}Watching assetpacks, last update: ${new Date().toISOString()}\n\n`);
            await listBundles(assetpacks, options.withwatchcounts);
            await waiter;
          }
        }
      }
    },
    check: {
      description: "Check if assetpacks are okay. List any errors. Omit or use '*' to check all",
      arguments: [{ name: "[assetpacks...]", description: "Asset packs to check" }],
      async main({ args: { assetpacks } }) {
        for (const broken of (await getBundles(assetpacks)).filter(bundle => bundle.iscompiling || bundle.haserrors || bundle.haswarnings)) {
          if (await printBundleMessages(broken.outputtag)) //errors?
            process.exitCode = 1;
        }
      }
    },
    compile: {
      description: "Compile an asset pack. Use '*' to compile all",
      arguments: [{ name: "<assetpacks...>", description: "Asset packs to recompile", type: assetPackOption }],
      flags: {
        verbose: { default: false, description: "verbose log level" },
        foreground: { default: false, description: "Recompile in foreground, don't use any assetpack service" },
        production: { default: false, description: "force production compile" },
        development: { default: false, description: "force development compile" },
        onlyfailed: { default: false, description: "Only recompile failed asset packs" },
      },
      async main({ args: { assetpacks }, opts: options }) {
        if ((options.development || options.production) && !options.foreground)
          throw new Error("Cannot specify --development or --production without --foreground");

        if (options.foreground) {
          process.exitCode = await runForegroundCompile(assetpacks as string[], options) ? 0 : 1;
          return;
        }

        const bundles = await getBundles(assetpacks as string[], { onlyfailed: options.onlyfailed });
        if (!bundles.length) {
          if (!options.quiet)
            console.log("No assetpacks to recompile");
          return;
        }

        for (const match of bundles)
          await (await getControlClient()).recompileBundle(match.outputtag);

        if (!options.quiet)
          console.log("Recompile scheduled, waiting to finish");

        const success = await waitForCompilation(assetpacks as string[], !options.quiet);
        process.exitCode = success ? 0 : 1;
      }
    },
    info: {
      description: "Detailed info about an assetpack",
      arguments: [{ name: "<assetpack>", description: "Asset pack to show info for" }],
      async main({ args: { assetpack } }) {
        const bundles = await getBundles([assetpack]);
        for (const bundle of bundles) {
          console.log(bundle.outputtag);
          console.log(" Status: " + getBundleStatusString(bundle));
          console.log(" Compiler: " + (bundle.iscompiling ? "\x1b[1;33mcompiling\x1b[0m" : bundle.requirecompile ? "scheduled" : "idle"));
          if (bundle.lastcompile)
            console.log(" Last compile: " + bundle.lastcompile.toISOString());
          await printBundleMessages(bundle.outputtag);
          console.log();
        }
      }
    },
    wait: {
      description: "Wait for the assetpacks to be compiled. Omit or use '*' to wait for all",
      arguments: [{ name: "[assetpacks...]", description: "Asset packs to wait for" }],
      async main({ args: { assetpacks }, opts: options }) {
        const success = await waitForCompilation(assetpacks, !options.quiet);
        process.exitCode = success ? 0 : 1;
      }
    },
    autocompile: {
      description: "Configure autocompilation of production packages",
      arguments: [{ name: "[state]", description: "on/off", type: enumOption(["on", "off"]) }],
      async main({ args: { state } }) {
        if (!state) {
          const config = await loadAssetPacksConfig();
          console.log(`Assetpack autocompilation is ${config.suspendAutoCompile ? "off" : "on"}`);
          return;
        }

        if (state !== "on" && state !== "off")
          throw new Error("Allowed autocompilation values: on/off");

        await runInWork(() => writeRegistryKey("publisher:bundledassets.suspendautocompile", state === "off"));
        await (await getControlClient()).reload();
      }
    },
    restart: {
      description: "Restart assetpack control",
      async main({ opts: options }) {
        const nodeservices = await openBackendService("platform:nodeservices");
        await nodeservices.restart("platform:assetpacks");

        if (!options.quiet)
          console.log("Assetpack service restarted");
      }
    },
  }
}, { argv });

function waitForEvent<Mask extends keyof BackendEvents>(eventmask: Mask): Promise<void> {
  const defer = Promise.withResolvers<void>();
  const sub = subscribe(eventmask, () => {
    void sub.then(resolvedSub => resolvedSub.setMasks([])); //unsubscribe
    defer.resolve();
  });
  return defer.promise;
}

function getBundleStatusString(bundle: AssetPackMiniStatus) {
  return bundle.hasstatus ?
    bundle.haserrors ? `${ansiCmd("bold", "red")}errors${ansiCmd("reset")}`
      : bundle.haswarnings ? `${ansiCmd("bold", "yellow")}warnings${ansiCmd("reset")}`
        : "ok" : "n/a";
}

async function getControlClient(): Promise<GetBackendServiceInterface<"platform:assetpacks">> {
  if (!client) {
    const aborter = new AbortController;
    const source = `wh assetpack ${process.argv.slice(2).join(' ')}`;
    client = openBackendService("platform:assetpacks", [source], { timeout: 30000, linger: false });
    const warnDelay = sleep(3000, { signal: aborter.signal }).then(() => ({ slow: true }));
    if ("slow" in (await Promise.race([client, warnDelay])))
      console.log("Waiting for assetpack control to be available...");

    aborter.abort(); //prevents the 3s 'slow message' from keeping the process open
  }
  return await client;
}

async function getBundles(masks: string[], { onlyfailed = false } = {}) {
  const status = await (await getControlClient()).getStatus();
  const maskRegExp = masks.length ? regExpFromWildcards(masks) : null;
  const bundles = status.bundles
    .filter(bundle => maskRegExp ? maskRegExp.test(bundle.outputtag) : true)
    .toSorted((lhs, rhs) => lhs.outputtag.localeCompare(rhs.outputtag));
  if (!bundles.length && !runData.globalOpts.allowMissing)
    throw new Error(`No assetpacks match masks: ${masks.join(",")}`);

  return bundles.filter(bundle => !onlyfailed || bundle.haserrors);
}

async function listBundles(masks: string[], withwatchcounts: boolean) {
  let bundles = await getBundles(masks);
  if (runData.globalOpts.quiet) {
    bundles = bundles.filter(bundle => bundle.haserrors);
  }
  const blen = Math.max(...bundles.map(bundle => bundle.outputtag.length));
  for (const bundle of bundles) {
    const bundlestatus = getBundleStatusString(bundle);
    const compiling = bundle.iscompiling ? `${ansiCmd("bold", "magenta")}build${ansiCmd("reset")}` : bundle.requirecompile ? "dirty" : "-";
    console.log(bundle.outputtag.padEnd(blen) + "\t" + bundlestatus + (withwatchcounts ? "\t" + (bundle.watchcount === 0 ? "-" : bundle.watchcount) : "") + "\t" + compiling);
  }
}

async function printBundleMessages(tag: string) {
  const data = await (await getControlClient()).getBundleStatus(tag);
  if (!data)
    throw new Error(`No bundle with tag ${tag}`);

  const anyError = data.messages.find(msg => msg.type === "error");
  if (anyError) {
    console.log(`Bundle ${tag} has the following errors:`);
  } else if (data.messages.length) {
    console.log(`Bundle ${tag} has the following messages:`);
  }
  logValidationMessagesToConsole(data.messages);
  return anyError;
}

async function waitForCompilation(masks: string[], verbose: boolean): Promise<boolean> {
  let lastcompiling: string[] = [];
  const aborter = new AbortController;
  const timeout = sleep(15 * 60 * 1000, { signal: aborter.signal }); //ensure we abort at some point... but this also keeps us alive during delayUntilEvet!
  void timeout.then(() => {
    console.error("Timeout");
    process.exit(2);
  });

  for (; ;) {
    const waiter = waitForEvent("platform:assetpackcontrol.update");
    const bundles = await getBundles(masks);
    const compiling = bundles.filter(bundle => bundle.iscompiling).map(bundle => bundle.outputtag);
    // eslint-disable-next-line @typescript-eslint/no-loop-func
    const newcompiling = compiling.filter(tag => !lastcompiling.includes(tag));
    if (verbose && newcompiling.length)
      console.log(`Now compiling: ${newcompiling.join(", ")}`);

    const finished = lastcompiling.filter(tag => !compiling.includes(tag));
    if (verbose && finished.length)
      console.log(`Finished: ${finished.join(", ")}`);

    if (!compiling.length)
      break;

    lastcompiling = compiling;
    await waiter;
  }

  //the wait is over
  const failedpacks = (await getBundles(masks)).filter(_ => _.haserrors);
  if (verbose)
    for (const failed of failedpacks)
      await printBundleMessages(failed.outputtag);

  aborter.abort(); //stop the timeout
  return failedpacks.length === 0;
}

async function runForegroundCompile(masks: string[], options: { development?: boolean; production?: boolean; verbose: boolean }) {
  const bundleMask = regExpFromWildcards(masks);
  /* TODO this will no longer support directly compiling adhoc packages - we should probably build a system where TS generates the bundleconfig for adhoc
          packges and let you specify a direct path to compile.ts. but this will require moving adhoc bundle and header generation from HS to TS

          PS: directly compiling adhoc bundles is now what recompileAdhoc is for, so it's easy to re-expose at one point */
  // TODO consider getting raw config instead of relying on extracts
  const bundles = getExtractedConfig("assetpacks").filter(assetpack => assetpack.name.match(bundleMask));
  if (bundles.length === 0)
    throw new Error(`No assetpacks match masks: ${masks.join(",")}`);

  let globalIsDev: boolean | undefined;

  if (options.development)
    if (options.production)
      throw new Error("Cannot specify both --development and --production");
    else
      globalIsDev = true;
  else if (options.production)
    globalIsDev = false;

  let anyError = false;
  await Promise.all(bundles.map(async (bundle) => {
    const isdev = globalIsDev ?? (await readBundleSettings(bundle.name)).dev;
    const data = buildRecompileSettings(bundle, { dev: isdev });
    if (options.verbose)
      console.log(JSON.stringify(data, null, 2));

    try {
      if (options.verbose)
        data.logLevel = "verbose";

      const result = await recompile(data);
      if (options.verbose)
        console.log(JSON.stringify(result, null, 2));

      logValidationMessagesToConsole(result.messages);
      if (result.messages.some(msg => msg.type === "error"))
        anyError = true;

    } catch (e) {
      console.error(e);
      anyError = true;
    }
  }));

  return !anyError;
}

import { loadAssetPacksConfig } from '@mod-platform/js/assetpacks/api';
import type { AssetPackMiniStatus } from '@mod-platform/js/devsupport/devbridge';
import { logValidationMessagesToConsole } from '@mod-platform/js/devsupport/validation';
import { openBackendService, subscribe, writeRegistryKey, type GetBackendServiceInterface } from '@webhare/services';
import { regExpFromWildcards, sleep } from '@webhare/std';
import { runInWork } from '@webhare/whdb';
import { program } from 'commander'; //https://www.npmjs.com/package/commander
import { ansiCmd } from '@webhare/cli';
import { getExtractedConfig } from '@mod-system/js/internal/configuration';
import { readBundleSettings } from '@mod-platform/js/assetpacks/support';
import { buildRecompileSettings, recompile } from '@mod-platform/js/assetpacks/compiletask';

let client: Promise<GetBackendServiceInterface<"platform:assetpacks">> | undefined;

program
  .name('wh assetpack')
  .description('Manage asset packs')
  .option("-q --quiet", "Don't report anything that's not an error");

program.command('list')
  .description("List asset packs")
  .argument("[assetpacks...]", "Asset packs to list")
  .option("--withwatchcounts", "Show watch counts")
  .option("--watch", "Watch asset packs")
  .action(async (assetpacks, options) => {
    if (!options.watch) {
      await listBundles(assetpacks, options.withwatchcounts);
    } else {
      for (; ;) {
        setTimeout(() => { }, 86400 * 1000); //keep the process alive
        const waiter = waitForEvent("publisher:assetpackcontrol.change.*");
        console.log(`${ansiCmd("erasedisplay", { pos: { x: 2, y: 2 } })}Watching assetpacks, last update: ${new Date().toISOString()}\n\n`);
        await listBundles(assetpacks, options.withwatchcounts);
        await waiter;
      }
    }
  });

program.command("check")
  .description("Check if assetpacks are okay. List any errors. Omit or use '*' to check all")
  .argument("[assetpacks...]", "Asset packs to check")
  .action(async (assetpacks) => {
    for (const broken of (await getBundles(assetpacks)).filter(bundle => bundle.iscompiling || bundle.haserrors)) {
      await printBundleMessages(broken.outputtag);
      process.exitCode = 1;
    }
  });

program.command("compile")
  .description("Compile an asset pack. Use '*' to compile all")
  .argument("<assetpacks...>", "Asset packs to recompile")
  .option('-v, --verbose', 'verbose log level')
  .option("-f, --foreground", "Recompile in foreground, don't use any assetpack service")
  .option('--production', 'force production compile')
  .option('--development', 'force development compile')
  .option("--onlyfailed", "Only recompile failed asset packs")
  .action(async (assetpacks, options) => {
    if ((options.development || options.production) && !options.froreground)
      throw new Error("Cannot specify --development or --production without --foreground");

    if (options.foreground) {
      process.exitCode = await runForegroundCompile(assetpacks, options) ? 0 : 1;
      return;
    }

    const bundles = await getBundles(assetpacks, { onlyfailed: options.onlyfailed });
    if (!bundles.length) {
      if (!program.opts().quiet)
        console.log("No assetpacks to recompile");
      return;
    }

    for (const match of bundles)
      await (await getControlClient()).recompileBundle(match.outputtag);

    if (!program.opts().quiet)
      console.log("Recompile scheduled, waiting to finish");

    const success = await waitForCompilation(assetpacks, !program.opts().quiet);
    process.exitCode = success ? 0 : 1;
  });

program.command("info")
  .description("Detailed info about an assetpack")
  .argument("<assetpack>", "Asset pack to show info for")
  .action(async (assetpack) => {
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
  });

program.command("wait")
  .description("Wait for the assetpacks to be compiled. Omit or use '*' to wait for all")
  .argument("[assetpacks...]", "Asset packs to wait for")
  .action(async (assetpacks) => {
    const success = await waitForCompilation(assetpacks, !program.opts().quiet);
    process.exitCode = success ? 0 : 1;
  });

program.command("autocompile")
  .description("Configure autocompilation of production packages")
  .argument("[state]", "on/off")
  .action(async (state) => {
    if (!state) {
      const config = await loadAssetPacksConfig();
      console.log(`Assetpack autocompilation is ${config.suspendAutoCompile ? "off" : "on"}`);
      return;
    }

    if (state !== "on" && state !== "off")
      throw new Error("Allowed autocompilation values: on/off");

    await runInWork(() => writeRegistryKey<boolean>("publisher.bundledassets.suspendautocompile", state === "off"));
    await (await getControlClient()).reload();
  });

program.command("restart")
  .description("Restart assetpack control")
  .action(async () => {
    //TODO once we have a nice global service mgmt api that can find services inside other processes, switch to that
    const nodeservices = await openBackendService("platform:nodeservices");
    await nodeservices.restart("platform:assetpacks");

    if (!program.opts().quiet)
      console.log("Assetpack service restarted");
  });

program.parse(process.argv.map(arg => {
  if (arg === "recompile") {
    //TODO once live_api has switched to wh compile, we can drop this hidden alias
    console.warn("You should switch to 'wh assetpack compile' in WH5.7+");
    return "compile";
  }
  return arg;
}));

function waitForEvent(eventmask: string) {
  const defer = Promise.withResolvers<void>();
  const sub = subscribe(eventmask, () => {
    void sub.then(resolvedSub => resolvedSub.setMasks([])); //unsubscribe
    defer.resolve();
  });
  return defer.promise;
}

function getBundleStatusString(bundle: AssetPackMiniStatus) {
  return bundle.hasstatus ? bundle.haserrors ? `${ansiCmd("bold", "red")}errors${ansiCmd("reset")}` : "ok" : "n/a";
}

async function getControlClient(): Promise<GetBackendServiceInterface<"platform:assetpacks">> {
  if (!client) {
    const aborter = new AbortController;
    const source = `wh assetpack ${process.argv.slice(2).join(' ')}`;
    client = openBackendService("platform:assetpacks", [source], { timeout: 30000, linger: false });
    const warnDelay = sleep(3000, { signal: aborter.signal }).then(() => ({ slow: true }));
    if ("slow" in (await Promise.race([client, warnDelay])))
      console.log("Waiting for assetpack control to be available...");

    aborter.abort(); //prevents the 3s from keeping the process open
  }
  return await client;
}

async function getBundles(masks: string[], { onlyfailed = false } = {}) {
  const status = await (await getControlClient()).getStatus();
  const maskRegExp = masks.length ? regExpFromWildcards(masks) : null;
  const bundles = status.bundles
    .filter(bundle => maskRegExp ? maskRegExp.test(bundle.outputtag) : true)
    .toSorted((lhs, rhs) => lhs.outputtag.localeCompare(rhs.outputtag));
  if (!bundles.length)
    throw new Error(`No assetpacks match masks: ${masks.join(",")}`);

  return bundles.filter(bundle => !onlyfailed || bundle.haserrors);
}

async function listBundles(masks: string[], withwatchcounts: boolean) {
  const bundles = await getBundles(masks);
  if (program.opts().quiet) {
    bundles.filter(bundle => bundle.haserrors);
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

  if (data.messages.find(msg => msg.type === "error")) {
    console.log(`Bundle ${tag} has the following errors:`);
  } else if (data.messages.length) {
    console.log(`Bundle ${tag} has the following messages:`);
  }
  logValidationMessagesToConsole(data.messages);
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
    const waiter = waitForEvent("publisher:assetpackcontrol.change.*");
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

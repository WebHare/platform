// syntax: <assetpack>
// short: Recompile a specific assetpack

/* eg:
   wh publisher:compile platform:tollium
*/

import { program } from 'commander'; //https://www.npmjs.com/package/commander
import { Bundle, buildRecompileSettings, recompile } from '@mod-publisher/js/internal/esbuild/compiletask';
import { loadlib } from "@webhare/harescript";
import { wildcardsToRegExp } from '@webhare/std';
import { getExtractedConfig } from '@mod-system/js/internal/configuration';

program.name('wh publisher:compile')
  .option('-v, --verbose', 'verbose log level')
  .option('--production', 'force production compile')
  .option('--development', 'force development compile')
  .argument('<assetpack>', 'Assetpack to compile')
  .parse();

async function main() {
  const verbose = program.opts().verbose;
  const bundlename = program.args[0];

  let globalIsDev: boolean | undefined;

  if (program.opts().development)
    if (program.opts().production)
      throw new Error("Cannot specify both --development and --production");
    else
      globalIsDev = true;
  else if (program.opts().production)
    globalIsDev = false;

  //if globalIsDev is undefined, we'll look at the actual pacakge config (and crash if no database is online)

  /* TODO this will no longer support directly compiling adhoc packages - we should probably build a system where TS generates the bundleconfig for adhoc
          packges and let you specify a direct path to compile.ts. but this will require moving adhoc bundle and header generation from HS to TS

          PS: directly compiling adhoc bundles is now what recompileAdhoc is for, so it's easy to re-expose at one point */
  const bundleMask = new RegExp(`^${wildcardsToRegExp(bundlename)}$`);
  const bundles = getExtractedConfig("assetpacks").filter(assetpack => assetpack.name.match(bundleMask));
  if (bundles.length === 0)
    throw new Error(`No bundle matches '${bundlename}'`);

  await Promise.all(bundles.map(async (bundle) => {
    const isdev = globalIsDev ?? (await loadlib('mod::publisher/lib/internal/webdesign/designfilesapi2.whlib').GetBundle(bundlename) as Bundle).isdev;
    const data = buildRecompileSettings(bundle, isdev);
    if (verbose)
      console.log(JSON.stringify(data, null, 2));

    try {
      if (verbose)
        data.logLevel = "verbose";

      const result = await recompile(data);
      if (verbose)
        console.log(JSON.stringify(result, null, 2));

      if (result.haserrors) {
        console.error("There were errors", result.errors);
        process.exitCode = 1;
      }
    } catch (e) {
      console.error(e);
      process.exitCode = 1;
    }
  }));
}

main().then(() => { }, (e) => { console.error(e); process.exit(1); });

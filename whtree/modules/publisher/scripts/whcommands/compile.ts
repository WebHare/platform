// syntax: <assetpack>
// short: Recompile a specific assetpack

/* eg:
   wh publisher:compile platform:tollium
*/

import { program } from 'commander'; //https://www.npmjs.com/package/commander
import { Bundle, buildRecompileSettings, recompile } from '@mod-publisher/js/internal/esbuild/compiletask';
import { loadlib } from "@webhare/harescript";

program.name('wh publisher:compile')
  .option('-v, --verbose', 'verbose log level')
  .option('--production', 'force production compile')
  .option('--development', 'force development compile')
  .argument('<assetpack>', 'Assetpack to compile')
  .parse();

async function main() {
  const verbose = program.opts().verbose;
  const bundlename = program.args[0];

  let isdev: boolean;

  if (program.opts().development)
    if (program.opts().production)
      throw new Error("Cannot specify both --development and --production");
    else
      isdev = true;
  else if (program.opts().production)
    isdev = false;
  else {
    const config = await loadlib('mod::publisher/lib/internal/webdesign/designfilesapi2.whlib').GetBundle(bundlename) as Bundle;
    isdev = config.isdev;
  }

  const data = await buildRecompileSettings(bundlename, isdev);
  if (verbose)
    console.log(JSON.stringify(data, null, 2));

  try {
    if (verbose)
      data.logLevel = "verbose";

    const result = await recompile(data);
    if (verbose)
      console.log(JSON.stringify(result, null, 2));

    if (result.haserrors)
      console.error("There were errors", result.errors);
    process.exit(result.haserrors === false ? 0 : 1);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

main().then(() => { }, (e) => { console.error(e); process.exit(1); });

// syntax: <assetpack>
// short: Recompile a specific assetpack

/* eg:
   wh publisher:compile tollium:webinterface.dev
*/

import { program } from 'commander'; //https://www.npmjs.com/package/commander
import { Bundle, RecompileSettings, recompile } from '@mod-publisher/js/internal/esbuild/compiletask';
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

  const bundle = await loadlib('mod::publisher/lib/internal/webdesign/designfilesapi2.whlib').GetBundle(bundlename) as Bundle;
  if (program.opts().development)
    bundle.isdev = true;
  if (program.opts().production)
    bundle.isdev = false;

  if (verbose)
    console.log(JSON.stringify(bundle, null, 2));

  const data: RecompileSettings = {
    bundle: bundle,
    compiletoken: "compile.ts"
  };

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

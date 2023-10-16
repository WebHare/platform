// syntax: <assetpack>
// short: Recompile a specific assetpack

/* eg:
   wh publisher:compile tollium:webinterface.dev
*/

import { program } from 'commander'; //https://www.npmjs.com/package/commander
import { Bundle, RecompileSettings, recompile } from '@mod-publisher/js/internal/esbuild/compiletask';
import * as services from "@webhare/services";

async function main(bundlename: string, options: { verbose: boolean }) {

  const bundle = await services.callHareScript('mod::publisher/lib/internal/webdesign/designfilesapi2.whlib#GetBundle', [bundlename]) as Bundle;
  console.log(bundle);

  const data: RecompileSettings = {
    bundle: bundle,
    compiletoken: "compile.ts"
  };

  try {
    if (options.verbose)
      data.logLevel = "verbose";

    const result = await recompile(data);
    console.log("total result", result);
    console.log("dependencies", result.info.dependencies);
    console.log("---assets---");
    console.log(result.assetoverview.assets);
    console.log("---structured response---");
    console.log("Reported errors", result.info.errors); //FIXME should be at high levlel 'info' should go

    try {
      JSON.stringify(result);
    } catch (e) {//detect cycles etc
      console.error("FAILED TO STRINGIFY RESULT!", e);
      process.exit(1);
    }
    process.exit(result.haserrors === false ? 0 : 1);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

program.name('wh publisher:compile')
  .option('-v, --verbose', 'verbose log level')
  .argument('<assetpack>', 'Assetpack to compile')
  .parse();

const verbose = program.opts().verbose;
main(program.args[0], { verbose });

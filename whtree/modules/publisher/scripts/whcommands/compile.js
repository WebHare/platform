/* wh publisher:compile <assetpack>

   eg

   wh publisher:compile tollium:webinterface.dev
*/
const services = require("@webhare/services");

async function main(bundlename, options)
{
  var taskcontext = {};
  let data = { directcompile:true };
  let assetCompiler = require('@mod-publisher/js/internal/esbuild/compiletask.es');

  let baseconfig = await services.callHareScript('mod::publisher/lib/internal/webdesign/designfilesapi2.whlib#GetAssetpacksBaseConfig', []);
  let bundle = await services.callHareScript('mod::publisher/lib/internal/webdesign/designfilesapi2.whlib#GetBundle', [bundlename]);
  console.error(bundle);

  data.baseconfig = baseconfig;
  data.bundle = bundle;
  console.log(taskcontext,data);

  let completionpromise = new Promise( resolve => taskcontext.resolveByCompletion = resolve );

  try
  {
    if(options.verbose)
      data.logLevel = "verbose";
    assetCompiler(taskcontext, data);

    let result = await completionpromise;
    console.log("total result",result);
    console.log("dependencies",result.info.dependencies);
    console.log("---assets---");
    console.log(result.info.assets);
    console.log("---structured response---");
    console.log("Reported errors",result.info.errors); //FIXME should be at high levlel 'info' should go

    try { JSON.stringify(result); } //detect cycles etc
    catch (e)
    {
      console.error("FAILED TO STRINGIFY RESULT!", e);
      process.exit(1);
    }
    process.exit(result.haserrors===false ? 0 : 1);
  }
  catch(e)
  {
    console.error(e);
    process.exit(1);
  }
}

let getopt = require('node-getopt/lib/getopt.js').create([
  ['h' , 'help'                , 'display this help']
 ,['v' , 'verbose'             , 'verbose log level']
])              // create Getopt instance
.bindHelp()     // bind option 'help' to default action
.parseSystem(); // parse command line

let bundle = getopt.argv[0];
if(!bundle)
{
  console.error("Specify bundle to compile");
  process.exit(1);
  return;
}

main(bundle, { verbose: !!getopt.options.v });

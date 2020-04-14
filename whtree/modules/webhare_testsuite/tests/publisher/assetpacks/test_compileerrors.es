/* globals describe it */

const assert = require("assert");
const fs = require("fs");

const bridge = require('@mod-system/js/wh/bridge');
let baseconfig;
let assetCompiler = require('@mod-publisher/js/internal/assetpackcompile.es');

async function compileAdhocTestBundle(entrypoint)
{
  let bundle = await bridge.invoke('mod::publisher/lib/internal/webdesign/designfilesapi2.whlib', 'GetBundle', "tollium:webinterface");

  //TODO nicer way to init a bundle
  bundle.outputtag = "webhare_testsuite:compileerrors";
  bundle.entrypoint = entrypoint;
  bundle.outputpath = "/tmp/compileerrors-build-test/";
  if (!fs.existsSync(bundle.outputpath))
    fs.mkdirSync(bundle.outputpath);

    //we need a taskcontext to invoke the assetCompiler, as it thinks its an ephemeral task runner
  let taskcontext = {};
  let completionpromise = new Promise( resolve => taskcontext.resolveByCompletion = resolve );

  let data = { directcompile:true, baseconfig, bundle };
  assetCompiler(taskcontext, data);

  let result = await completionpromise;
  JSON.stringify(result); //detect cycles etc;
  return result;
}

describe("test_compileerrors", (done) =>
{
  it("setup", async function()
  {
    await bridge.connect();
    baseconfig = await bridge.invoke('mod::publisher/lib/internal/webdesign/designfilesapi2.whlib', 'GetAssetpacksBaseConfig');

  });

  it("should properly detect broken scss", async function()
  {
    this.timeout(60000);

    let result = await compileAdhocTestBundle(__dirname + "/broken-scss/broken-scss.es");
    assert(result.haserrors === true);

    let filedeps = Array.from(result.info.dependencies.fileDependencies);
    assert(filedeps.includes(__dirname + "/broken-scss/broken-scss.es"));
    assert(filedeps.includes(__dirname + "/broken-scss/broken-scss.scss"));
    assert(filedeps.filter(entry => entry[0] != '/').length == 0); //no weird entries, no 'stdin'...

    let missingdeps = Array.from(result.info.dependencies.missingDependencies);
    assert(missingdeps.length == 0);

  });


  it("cleanup", () =>
  {
    bridge.close(); //otherwise mocha wont terminate
  });

});

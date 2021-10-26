/* globals describe it */

/* now more of a generic 'compiler issues' test

   to manually run this testset for both webpack and esbuild:

   WEBHARE_ASSETPACK_FORCE_COMPATIBILITY=esnext wh runtest publisher.assetpacks.test_compileerrors
   WEBHARE_ASSETPACK_FORCE_COMPATIBILITY=modern wh runtest publisher.assetpacks.test_compileerrors

   add WEBHARE_ASSETPACK_DEBUGREWRITES=1  for rewrite debug info
*/

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const bridge = require('@mod-system/js/wh/bridge');
let baseconfig;
let assetCompiler = require('@mod-publisher/js/internal/assetcompile.es');

async function compileAdhocTestBundle(entrypoint, isdev)
{
  let bundle = await bridge.invoke('mod::publisher/lib/internal/webdesign/designfilesapi2.whlib', 'GetBundle', isdev ? "tollium:webinterface.dev" : "tollium:webinterface");

  //TODO nicer way to init a bundle
  bundle.outputtag = "webhare_testsuite:compileerrors";
  bundle.entrypoint = entrypoint;
  bundle.outputpath = "/tmp/compileerrors-build-test/";

  if(fs.existsSync(bundle.outputpath))
    fs.rmdirSync(bundle.outputpath, {recursive:true});
  fs.mkdirSync(bundle.outputpath);

    //we need a taskcontext to invoke the assetCompiler, as it thinks its an ephemeral task runner
  let taskcontext = {};
  let completionpromise = new Promise( resolve => taskcontext.resolveByCompletion = resolve );

  let data = { directcompile:true, baseconfig, bundle };
  assetCompiler(taskcontext, data);

  let result = await completionpromise;
  JSON.stringify(result); //detect cycles etc;
  if(!result.haserrors)
  {
    //verify the manifest
    let manifest = JSON.parse(fs.readFileSync("/tmp/compileerrors-build-test/build/apmanifest.json"));
    assert(1, manifest.version);
    assert(manifest.assets.find(file => file.subpath == 'ap.js' && !file.compressed && !file.sourcemap));
    assert(!!isdev === !manifest.assets.find(file => file.subpath == 'ap.js.gz' && file.compressed && !file.sourcemap));

    manifest.assets.forEach(file =>
      {
        let subpath = file.subpath;
        if(subpath.startsWith('st/') && result.compiler=='webpack') //the move to 'st/' isnt done during build, but after... so don't look for st/ here. esbuild stops bothering with the st/ folder
          subpath = subpath.substr(3);

        let fullpath = path.join("/tmp/compileerrors-build-test/build/", subpath.toLowerCase());
        if(!fs.existsSync(fullpath))
          throw new Error(`Missing file ${fullpath}`);
      });
   }

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
    this.timeout(60000); //esbuild doesn't need this, but webpack surely does...

    let result = await compileAdhocTestBundle(__dirname + "/broken-scss/broken-scss.es", true);
    assert(result.haserrors === true);
    assert(Array.isArray(result.info.errors));
    assert(result.info.errors.length >= 1);
    assert(result.info.errors[0].message);
    assert(result.info.errors[0].resource); //note: esbuild creates relative paths, webpack absolute paths. does this matter anywhere?

    let filedeps = Array.from(result.info.dependencies.fileDependencies);
    assert(filedeps.includes(path.join(__dirname, "/broken-scss/broken-scss.scss")));
    assert(filedeps.includes(path.join(__dirname, "/broken-scss/broken-scss.es")));
    assert(filedeps.filter(entry => entry[0] != '/').length == 0); //no weird entries, no 'stdin'...

    let missingdeps = Array.from(result.info.dependencies.missingDependencies);
    assert(missingdeps.length == 0);

  });

  it("Any package (or at least with ES files) includes the poyfill as dep (prod)", async function()
  {
    this.timeout(60000);

    let result = await compileAdhocTestBundle(__dirname + "/dependencies/base-for-deps.es", false);
    assert(result.haserrors === false);

    let filedeps = Array.from(result.info.dependencies.fileDependencies);
    assert(filedeps.includes(path.join(__dirname,"/dependencies/base-for-deps.es")));
    assert(filedeps.includes(path.join(bridge.getInstallationRoot(),"modules/publisher/js/internal/polyfills/modern.es")));
  });

  it("rpc.json files pull in system/js/wh/rpc.es as dependency (prod)", async function()
  {
    this.timeout(60000);

    let result = await compileAdhocTestBundle(__dirname + "/dependencies/base-for-deps.rpc.json", false);
    assert(result.haserrors === false);

    let filedeps = Array.from(result.info.dependencies.fileDependencies);
    assert(filedeps.includes(path.join(__dirname,"/dependencies/base-for-deps.rpc.json")));
    assert(filedeps.includes(path.join(bridge.getInstallationRoot(),"modules/system/js/wh/rpc.es")));
  });

  it("lang.json files pull in tollium/js/gettid.es as dependency", async function()
  {
    this.timeout(60000);

    let result = await compileAdhocTestBundle(__dirname + "/dependencies/base-for-deps.lang.json", true);
    assert(result.haserrors === false);

    let filedeps = Array.from(result.info.dependencies.fileDependencies);
    assert(filedeps.includes(path.join(__dirname,"/dependencies/base-for-deps.lang.json")));
    assert(filedeps.includes(path.join(bridge.getInstallationRoot(),"modules/tollium/js/gettid.es")));
  });

  it("combine-deps pulls all these in as dependencies", async function()
  {
    this.timeout(60000);

    let result = await compileAdhocTestBundle(__dirname + "/dependencies/combine-deps.es", true);
    assert(result.haserrors === false);

    let filedeps = Array.from(result.info.dependencies.fileDependencies);

    assert(filedeps.includes(path.join(__dirname,"/dependencies/base-for-deps.es")));
    assert(filedeps.includes(path.join(__dirname,"/dependencies/base-for-deps.lang.json")));
    assert(filedeps.includes(path.join(__dirname,"/dependencies/base-for-deps.rpc.json")));
    assert(filedeps.includes(path.join(__dirname,"/dependencies/base-for-deps.scss")));
    assert(filedeps.includes(path.join(bridge.getInstallationRoot(),"modules/publisher/js/internal/polyfills/modern.es")));
    assert(filedeps.includes(path.join(bridge.getInstallationRoot(),"modules/system/js/wh/rpc.es")));
    assert(filedeps.includes(path.join(bridge.getInstallationRoot(),"modules/tollium/js/gettid.es")));
    assert(filedeps.includes(path.join(bridge.getInstallationRoot(),"modules/tollium/web/img/buttonbar/bulletedlist.16x16.b.svg")));

    let missingdeps = Array.from(result.info.dependencies.missingDependencies);
    assert(missingdeps.length == 0);
  });

  it("test other tricky dependencies", async function()
  {
    this.timeout(60000);

    let result = await compileAdhocTestBundle(__dirname + "/dependencies/regressions.es");
    assert(result.haserrors === false);

    let filedeps = Array.from(result.info.dependencies.fileDependencies);

    assert(filedeps.includes(path.join(bridge.getInstallationRoot(),"modules/system/js/dompack/browserfix/reset.css")));
  });

  it("cleanup", () =>
  {
    bridge.close(); //otherwise mocha wont terminate
  });

});


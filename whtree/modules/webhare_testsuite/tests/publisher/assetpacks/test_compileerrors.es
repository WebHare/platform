/* globals describe it */

/* now more of a generic 'compiler issues' test

   to manually run this testset for both webpack and esbuild:

   wh runtest publisher.assetpacks.test_compileerrors_webpack
   wh runtest publisher.assetpacks.test_compileerrors_es2016
   wh runtest publisher.assetpacks.test_compileerrors_esnext

   set WEBHARE_ASSETPACK_DEBUGREWRITES=1 for rewrite debug info
*/

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const bridge = require('@mod-system/js/wh/bridge');
let baseconfig;
let assetCompiler = require('@mod-publisher/js/internal/assetcompile.es');

if(!process.env.WEBHARE_ASSETPACK_FORCE_COMPATIBILITY) //as long as we do both esnext AND modern... run the test twice
  throw new Error("WEBHARE_ASSETPACK_FORCE_COMPATIBILITY *must* be set to ensure you're running the test you want");

async function compileAdhocTestBundle(entrypoint, isdev)
{
  let bundle = await bridge.invoke('mod::publisher/lib/internal/webdesign/designfilesapi2.whlib', 'GetBundle', isdev ? "tollium:webinterface.dev" : "tollium:webinterface");

  //TODO nicer way to init a bundle
  bundle.outputtag = "webhare_testsuite:compileerrors";
  bundle.entrypoint = entrypoint;
  bundle.outputpath = "/tmp/compileerrors-build-test/";

  if(fs.existsSync(bundle.outputpath))
    fs.rmSync(bundle.outputpath, {recursive:true});
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
    if(!entrypoint.endsWith('.scss'))
    {
      assert(manifest.assets.find(file => file.subpath == 'ap.js' && !file.compressed && !file.sourcemap));
      assert(!!isdev === !manifest.assets.find(file => file.subpath == 'ap.js.gz' && file.compressed && !file.sourcemap));
    }

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

    //TODO preferably esbuild would also point to the SCSS, we'll re-investigate that once dart-sass improves its error output
    let acceptablenames = [ bridge.getModuleInstallationRoot("webhare_testsuite") + "tests/publisher/assetpacks/broken-scss/broken-scss.scss" // <-- webpack
                          , bridge.getModuleInstallationRoot("webhare_testsuite") + "tests/publisher/assetpacks/broken-scss/broken-scss.es"   // <-- esbuild
                          ];
    console.log("Acceptable locations:", acceptablenames);
    console.log("Reported location:", result.info.errors[0].resource);
    assert(acceptablenames.includes(result.info.errors[0].resource));

    let filedeps = Array.from(result.info.dependencies.fileDependencies);
    assert(filedeps.includes(path.join(__dirname, "/broken-scss/broken-scss.scss")));
    assert(filedeps.includes(path.join(__dirname, "/broken-scss/broken-scss.es")));
    assert(filedeps.filter(entry => entry[0] != '/').length == 0); //no weird entries, no 'stdin'...

    let missingdeps = Array.from(result.info.dependencies.missingDependencies);
    assert(missingdeps.length == 0);

  });

  it("should properly report broken location", async function()
  {
    this.timeout(60000); //esbuild doesn't need this, but webpack surely does...

    let result = await compileAdhocTestBundle(path.join(__dirname, "dependencies/include-import-fail.es"), true);
    assert(result.haserrors === true);
    assert(Array.isArray(result.info.errors));
    assert(result.info.errors.length >= 1);
    assert(result.info.errors[0].message);


    let acceptablenames = [ bridge.getModuleInstallationRoot("webhare_testsuite") + "tests/publisher/assetpacks/dependencies/deeper/import-fail.es" // <-- esbuild
                          ];
    console.log("Acceptable locations:", acceptablenames);
    console.log("Reported location:", result.info.errors[0].resource);
    assert(acceptablenames.includes(result.info.errors[0].resource));

    let filedeps = Array.from(result.info.dependencies.fileDependencies);

    assert(filedeps.includes(path.join(__dirname, "dependencies/include-import-fail.es")));
    assert(filedeps.includes(path.join(__dirname, "dependencies/deeper/import-fail.es")));
    assert(filedeps.filter(entry => entry[0] != '/').length == 0); //no weird entries, no 'stdin'...
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

  it("scss files dependencies", async function()
  {
    this.timeout(60000);

    let result = await compileAdhocTestBundle(path.join(__dirname,"dependencies/regressions.scss"), false);
    assert(result.haserrors === false);

    let filedeps = Array.from(result.info.dependencies.fileDependencies);
    assert(filedeps.includes(path.join(__dirname,"/dependencies/regressions.scss")));
    assert(filedeps.includes(path.join(__dirname,"/dependencies/deeper/deeper.scss")));

  });

  it("rpc.json files pull in system/js/wh/rpc.es as dependency (prod)", async function()
  {
    this.timeout(60000);

    let result = await compileAdhocTestBundle(__dirname + "/dependencies/base-for-deps.rpc.json", false);
    assert(result.haserrors === false);

    let filedeps = Array.from(result.info.dependencies.fileDependencies);
    assert(filedeps.includes(path.join(__dirname,"/dependencies/base-for-deps.rpc.json")));
    assert(filedeps.includes(path.join(bridge.getInstallationRoot(),"modules/system/js/wh/rpc.es")));
    assert(filedeps.includes(bridge.getModuleInstallationRoot("webhare_testsuite") + "lib/webservicetest.whlib"));
  });

  it("lang.json files pull in extra dependencies", async function()
  {
    this.timeout(60000);

    let result = await compileAdhocTestBundle(__dirname + "/dependencies/base-for-deps.lang.json", true);
    assert(result.haserrors === false);

    let filedeps = Array.from(result.info.dependencies.fileDependencies);
    assert(filedeps.includes(path.join(__dirname,"/dependencies/base-for-deps.lang.json")));
    assert(filedeps.includes(path.join(bridge.getInstallationRoot(),"modules/tollium/js/gettid.es")));
    assert(filedeps.includes(path.join(bridge.getInstallationRoot(),"modules/tollium/language/default.xml")));
    assert(filedeps.includes(path.join(bridge.getInstallationRoot(),"modules/tollium/language/nl.xml")));
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
    assert(filedeps.includes(path.join(bridge.getInstallationRoot(),"modules/tollium/language/default.xml")));
    assert(filedeps.includes(path.join(bridge.getInstallationRoot(),"modules/tollium/language/nl.xml")));
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


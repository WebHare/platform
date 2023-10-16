/* wh runtest publisher.assetpacks.test_compileerrors

   set WEBHARE_ASSETPACK_DEBUGREWRITES=1 for rewrite debug info
*/

import * as test from '@webhare/test';
import * as fs from "node:fs";
import * as path from "node:path";

import * as services from "@webhare/services";

import { recompile } from '@mod-publisher/js/internal/esbuild/compiletask';

//TODO these types should move to assetpackcontrol/bulder
interface AssetPackManifest {
  version: number;
  assets: Array<{ subpath: string; compressed: boolean; sourcemap: boolean }>;
}

interface CompileResult {
  haserrors: boolean;
  info: {
    errors: Array<{ message: string; resource: string }>
    ; dependencies: {
      fileDependencies: string[]
      ; missingDependencies: string[];
    };
  };
}

async function compileAdhocTestBundle(entrypoint: string, isdev: boolean) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- internal API, not documenting. we probably need to work closer with assetpackcnotrol anyway and avoid designfilesapi2
  const bundle = await services.callHareScript('mod::publisher/lib/internal/webdesign/designfilesapi2.whlib#GetBundle', ["webhare_testsuite:basetest"]) as any;

  //TODO nicer way to init a bundle
  bundle.outputtag = "webhare_testsuite:compileerrors";
  bundle.entrypoint = entrypoint;
  bundle.outputpath = "/tmp/compileerrors-build-test/";
  bundle.isdev = isdev;

  if (fs.existsSync(bundle.outputpath))
    fs.rmSync(bundle.outputpath, { recursive: true });
  fs.mkdirSync(bundle.outputpath);

  const data = { directcompile: true, bundle, compiletoken: "adhoctest" };
  const result = await recompile(data) as CompileResult;
  JSON.stringify(result); //detect cycles etc;
  if (!result.haserrors) {
    //verify the manifest
    const manifest = JSON.parse(fs.readFileSync("/tmp/compileerrors-build-test/build/apmanifest.json").toString()) as AssetPackManifest;
    test.eq(1, manifest.version);
    if (!entrypoint.endsWith('.scss')) {
      test.assert(manifest.assets.find(file => file.subpath == 'ap.js' && !file.compressed && !file.sourcemap));
      test.eq(!isdev, manifest.assets.some(file => file.subpath == 'ap.js.gz' && file.compressed && !file.sourcemap));
    }

    manifest.assets.forEach(file => {
      const subpath = file.subpath;
      const fullpath = path.join("/tmp/compileerrors-build-test/build/", subpath.toLowerCase());
      if (!fs.existsSync(fullpath))
        throw new Error(`Missing file ${fullpath}`);
    });
  }

  for (const dep of result.info.dependencies.fileDependencies) {
    if (dep.startsWith("//"))
      throw new Error(`Invalid depdenency path ${dep}`); //prefix '//' might leak through
  }

  return result;
}

async function testCompileerrors() {
  console.log("should properly detect broken scss");
  {
    const result = await compileAdhocTestBundle(__dirname + "/broken-scss/broken-scss.es", true);
    test.assert(result.haserrors === true);
    test.assert(Array.isArray(result.info.errors));
    test.assert(result.info.errors.length >= 1);
    test.assert(result.info.errors[0].message);

    //TODO preferably esbuild would also point to the SCSS, we'll re-investigate that once dart-sass improves its error output
    const acceptablenames = [
      services.config.module.webhare_testsuite.root + "tests/publisher/assetpacks/broken-scss/broken-scss.scss", // <-- webpack
      services.config.module.webhare_testsuite.root + "tests/publisher/assetpacks/broken-scss/broken-scss.es"   // <-- esbuild
    ];
    console.log("Acceptable locations:", acceptablenames);
    console.log("Reported location:", result.info.errors[0].resource);
    console.log(result.info);
    test.assert(acceptablenames.includes(result.info.errors[0].resource));

    const filedeps = Array.from(result.info.dependencies.fileDependencies);
    test.assert(filedeps.includes(path.join(__dirname, "/broken-scss/broken-scss.scss")));
    test.assert(filedeps.includes(path.join(__dirname, "/broken-scss/broken-scss.es")));
    test.assert(filedeps.filter(entry => entry[0] != '/').length == 0); //no weird entries, no 'stdin'...

    const missingdeps = Array.from(result.info.dependencies.missingDependencies);
    test.assert(missingdeps.length == 0);

  }

  console.log("should properly report broken location");
  {
    const result = await compileAdhocTestBundle(path.join(__dirname, "dependencies/include-import-fail.es"), true);
    test.assert(result.haserrors === true);
    test.assert(Array.isArray(result.info.errors));
    test.assert(result.info.errors.length >= 1);
    test.assert(result.info.errors[0].message);


    const acceptablenames = [services.config.module.webhare_testsuite.root + "tests/publisher/assetpacks/dependencies/deeper/import-fail.es"]; // <-- esbuild

    console.log("Acceptable locations:", acceptablenames);
    console.log("Reported location:", result.info.errors[0].resource);
    test.assert(acceptablenames.includes(result.info.errors[0].resource));

    const filedeps = Array.from(result.info.dependencies.fileDependencies);

    test.assert(filedeps.includes(path.join(__dirname, "dependencies/include-import-fail.es")));
    test.assert(filedeps.includes(path.join(__dirname, "dependencies/deeper/import-fail.es")));
    test.assert(filedeps.filter(entry => entry[0] != '/').length == 0); //no weird entries, no 'stdin'...
  }

  console.log("looking for a nonexisting node_module should register missingDependencies on node_modules");
  {
    let result = await compileAdhocTestBundle(path.join(__dirname, "dependencies/find-vendornamespace-module.es"), true);

    test.assert(result.haserrors === true);

    let missingdeps = Array.from(result.info.dependencies.missingDependencies);
    test.assert(missingdeps.includes(path.join(services.config.module.webhare_testsuite.root, "node_modules/@vendor/submodule")));
    test.assert(missingdeps.includes(path.join(services.config.module.webhare_testsuite.root, "node_modules/@vendor/submodule/index.js")));
    test.assert(missingdeps.includes(path.join(services.config.module.webhare_testsuite.root, "node_modules/@vendor/submodule/index.es")));
    test.assert(missingdeps.includes(path.join(services.config.module.webhare_testsuite.root, "node_modules/@vendor/submodule/package.json")));
    test.assert(missingdeps.includes(path.join(__dirname, "node_modules/@vendor/submodule")));
    test.assert(missingdeps.includes(path.join(__dirname, "node_modules/@vendor/submodule.js")));
    test.assert(missingdeps.includes(path.join(__dirname, "node_modules/@vendor/submodule.es")));
    test.assert(missingdeps.includes(path.join(__dirname, "node_modules/@vendor/submodule/index.js")));
    test.assert(missingdeps.includes(path.join(__dirname, "node_modules/@vendor/submodule/index.es")));
    test.assert(missingdeps.includes(path.join(__dirname, "node_modules/@vendor/submodule/package.json")));

    result = await compileAdhocTestBundle(path.join(__dirname, "dependencies/find-vendornamespace-stylesheet.scss"), true);
    test.assert(result.haserrors === true);

    missingdeps = Array.from(result.info.dependencies.missingDependencies);
    test.assert(missingdeps.includes(path.join(services.config.module.webhare_testsuite.root, "node_modules/@vendor/submodule/my.scss")));
    test.assert(missingdeps.includes(path.join(__dirname, "node_modules/@vendor/submodule/my.scss")));
    test.assert(missingdeps.includes(path.join(__dirname, "node_modules/@vendor/submodule/my.scss.scss")));
    test.assert(missingdeps.includes(path.join(__dirname, "node_modules/@vendor/submodule/my.scss.sass")));

    result = await compileAdhocTestBundle(path.join(__dirname, "dependencies/find-vendornamespace-stylesheet-singlequote.scss"), true);
    test.assert(result.haserrors === true);

    missingdeps = Array.from(result.info.dependencies.missingDependencies);
    test.assert(missingdeps.includes(path.join(services.config.module.webhare_testsuite.root, "node_modules/@vendor/submodule/my2.scss")));
    test.assert(missingdeps.includes(path.join(__dirname, "node_modules/@vendor/submodule/my2.scss")));
    test.assert(missingdeps.includes(path.join(__dirname, "node_modules/@vendor/submodule/my2.scss.scss")));
  }

  console.log("browser override in package.json works");
  {
    const result = await compileAdhocTestBundle(__dirname + "/data/browser-override", false);
    test.assert(result.haserrors === false);

    const filedeps = Array.from(result.info.dependencies.fileDependencies);
    test.assert(filedeps.includes(path.join(__dirname, "/data/browser-override/test.browser.mjs")));
    test.assert(!filedeps.includes(path.join(__dirname, "/data/browser-override/test.mjs")));
  }

  console.log("Any package (or at least with ES files) includes the poyfill as dep (prod)");
  {
    const result = await compileAdhocTestBundle(__dirname + "/dependencies/base-for-deps.es", false);
    test.assert(result.haserrors === false);

    const filedeps = Array.from(result.info.dependencies.fileDependencies);
    test.assert(filedeps.includes(path.join(__dirname, "/dependencies/base-for-deps.es")));
    test.assert(filedeps.includes(path.join(services.config.installationroot, "modules/publisher/js/internal/polyfills/modern.ts")));
  }

  console.log("scss files dependencies");
  {
    const result = await compileAdhocTestBundle(path.join(__dirname, "dependencies/regressions.scss"), false);
    test.assert(result.haserrors === false);

    const filedeps = Array.from(result.info.dependencies.fileDependencies);
    test.assert(filedeps.includes(path.join(__dirname, "/dependencies/regressions.scss")));
    test.assert(filedeps.includes(path.join(__dirname, "/dependencies/deeper/deeper.scss")));

    const css = fs.readFileSync("/tmp/compileerrors-build-test/build/ap.css").toString();
    const urls = [...css.matchAll(/(url\(.*\))/g)].map(_ => _[1]);
    test.assert(urls.length == 1);
    test.assert(urls[0].startsWith("url("));
    test.assert(!urls[0].startsWith("url(/"));
  }

  console.log("rpc.json files pull in system/js/wh/rpc.ts as dependency (prod)");
  {
    const result = await compileAdhocTestBundle(__dirname + "/dependencies/base-for-deps.rpc.json", false);
    test.assert(result.haserrors === false);

    const filedeps = Array.from(result.info.dependencies.fileDependencies);
    test.assert(filedeps.includes(path.join(__dirname, "/dependencies/base-for-deps.rpc.json")));
    test.assert(filedeps.includes(path.join(services.config.installationroot, "modules/system/js/wh/rpc.ts")));
    test.assert(filedeps.includes(services.config.module.webhare_testsuite.root + "lib/webservicetest.whlib"));
  }

  console.log("lang.json files pull in extra dependencies");
  {
    const result = await compileAdhocTestBundle(__dirname + "/dependencies/base-for-deps.lang.json", true);
    test.assert(result.haserrors === false);

    const filedeps = Array.from(result.info.dependencies.fileDependencies);
    test.assert(filedeps.includes(path.join(__dirname, "/dependencies/base-for-deps.lang.json")));
    test.assert(filedeps.includes(path.join(services.config.installationroot, "modules/tollium/js/gettid.ts")));
    test.assert(filedeps.includes(path.join(services.config.installationroot, "modules/tollium/language/default.xml")));
    test.assert(filedeps.includes(path.join(services.config.installationroot, "modules/tollium/language/nl.xml")));
  }

  console.log("combine-deps pulls all these in as dependencies");
  {
    const result = await compileAdhocTestBundle(__dirname + "/dependencies/combine-deps.es", true);
    console.log(result);
    test.assert(result.haserrors === false);

    const filedeps = Array.from(result.info.dependencies.fileDependencies);

    test.assert(filedeps.includes(path.join(__dirname, "/dependencies/base-for-deps.es")));
    test.assert(filedeps.includes(path.join(__dirname, "/dependencies/base-for-deps.lang.json")));
    test.assert(filedeps.includes(path.join(__dirname, "/dependencies/base-for-deps.rpc.json")));
    test.assert(filedeps.includes(path.join(__dirname, "/dependencies/base-for-deps.scss")));
    test.assert(filedeps.includes(path.join(services.config.installationroot, "modules/publisher/js/internal/polyfills/modern.ts")));
    test.assert(filedeps.includes(path.join(services.config.installationroot, "modules/system/js/wh/rpc.ts")));
    test.assert(filedeps.includes(path.join(services.config.installationroot, "modules/tollium/js/gettid.ts")));
    test.assert(filedeps.includes(path.join(services.config.installationroot, "modules/tollium/language/default.xml")));
    test.assert(filedeps.includes(path.join(services.config.installationroot, "modules/tollium/language/nl.xml")));
    test.assert(filedeps.includes(path.join(services.config.installationroot, "modules/tollium/web/img/buttonbar/bulletedlist.16x16.b.svg")));

    const missingdeps = Array.from(result.info.dependencies.missingDependencies);
    test.assert(missingdeps.length == 0);
  }

  console.log("test other tricky dependencies");
  {
    const result = await compileAdhocTestBundle(__dirname + "/dependencies/regressions.es", false);
    test.assert(result.haserrors === false);

    const filedeps = Array.from(result.info.dependencies.fileDependencies);

    test.assert(filedeps.includes(path.join(services.config.installationroot, "modules/system/js/dompack/browserfix/reset.css")));

    const css = fs.readFileSync("/tmp/compileerrors-build-test/build/ap.css").toString();
    test.assert(css.match(/.test2{.*margin-left:1px.*}/));
    test.assert(css.match(/.test3{.*margin-left:2px.*}/));
  }

  // Test for esbuild issue https://github.com/evanw/esbuild/issues/1657
  console.log("esbuild value collapse fix");
  {
    const result = await compileAdhocTestBundle(path.join(__dirname, "optimizations/regressions.es"), false);
    test.assert(result.haserrors === false);

    // Older versions of esbuild collapsed global values, i.e.
    //    margin-bottom: 0;
    //    margin-left: unset;
    //    margin-right: unset;
    //    margin-top: 0;
    //   became
    //    margin: 0 unset;

    const css = fs.readFileSync("/tmp/compileerrors-build-test/build/ap.css").toString();
    test.assert(css.match(/.test1a{.*margin-left:unset.*}/));
    test.assert(css.match(/.test1a{.*padding-left:initial.*}/));
    // Check if numerical values are collapsed properly
    test.assert(css.match(/.test1b{.*margin:0 1% auto 1px.*}/));
    // Avoid inset: collapse, safari v14 doesn't like this and we're in no rush to deprecate that one
    test.eq(/.test1c{.*top:.*}/, css);
    test.assert(!css.match(/.test1c{.*inset:.*}/));

    /* regression:
       font: 9pt/16px "Menlo", "Consolas", "DejaVu Sans Mono", "Courier New", "monospace";
       was output as
       font: 9pt/16px"Menlo", "Consolas", "DejaVu Sans Mono", "Courier New", "monospace";

       https://github.com/evanw/esbuild/issues/3452

       esbuild has fixed the bug, but we've dropped the css-tree module sidestepping this issue completely
    */
    test.assert(!css.match(/16pxMenlo/));
    test.assert(css.match(/16px Menlo/));
  }

  console.log("TypeScript is working");
  {
    let result = await compileAdhocTestBundle(__dirname + "/dependencies/typescript/test-typescript.ts", false);
    test.assert(result.haserrors === false);

    const filedeps = Array.from(result.info.dependencies.fileDependencies);
    test.assert(filedeps.includes(path.join(__dirname, "/dependencies/typescript/test-typescript.ts")), 'test-typescript.ts');
    test.assert(filedeps.includes(path.join(__dirname, "/dependencies/typescript/test-typescript-2.ts")), 'test-typescript-2.ts'); // loaded by test-typescript.ts
    test.assert(filedeps.includes(path.join(__dirname, "/dependencies/typescript/folder/index.ts")), 'typescript/index.ts'); // loaded by test-typescript.ts
    test.assert(filedeps.includes(path.join(services.config.installationroot, "modules/publisher/js/internal/polyfills/modern.ts")));

    result = await compileAdhocTestBundle(__dirname + "/dependencies/typescript/test-typescript-in-js.ts", false); //verify we cannot load TypeScript in JS
    test.assert(result.haserrors === true);
  }

  console.log("TypeScript with jsx is working");
  {
    const result = await compileAdhocTestBundle(__dirname + "/dependencies/typescript-jsx/test-typescript.tsx", false);
    test.assert(result.haserrors === false);

    const filedeps = Array.from(result.info.dependencies.fileDependencies);
    test.assert(filedeps.includes(path.join(__dirname, "/dependencies/typescript-jsx/test-typescript.tsx")), 'test-typescript.tsx');
    test.assert(filedeps.includes(path.join(__dirname, "/dependencies/typescript-jsx/test-typescript-2.tsx")), 'test-typescript-2.tsx'); // loaded by test-typescript.tsx
    test.assert(filedeps.includes(path.join(__dirname, "/dependencies/typescript-jsx/folder/index.tsx")), 'typescript/index.tsx'); // loaded by test-typescript.tsx
    test.assert(filedeps.includes(path.join(services.config.installationroot, "modules/publisher/js/internal/polyfills/modern.ts")));
  }
}

test.run([testCompileerrors]);

/* wh runtest publisher.assetpacks.test_compileerrors

   set WEBHARE_ASSETPACK_DEBUGREWRITES=1 for rewrite debug info
*/

import * as test from '@webhare/test';
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import * as child_process from "node:child_process";

import { buildRecompileSettings, recompile } from '@mod-platform/js/assetpacks/compiletask';
import type { AssetPackManifest, RecompileSettings } from '@mod-platform/js/assetpacks/types';
import { backendConfig, toFSPath, toResourcePath } from '@webhare/services';
import { getYMLAssetPacks, type AssetPack } from '@mod-system/js/internal/generation/gen_extracts';
import { parseAndValidateModuleDefYMLText } from '@mod-webhare_testsuite/js/config/testhelpers';

function mapDepPaths(deps: string[]) {
  return deps.map(dep => toFSPath(dep, { allowUnmatched: true }) ?? dep);
}

async function compileAdhocTestBundle(config: AssetPack, dev: boolean) {
  const settings: RecompileSettings = buildRecompileSettings(config, { dev });
  if (settings.bundle.config.entryPoint.startsWith('/'))
    settings.bundle.config.entryPoint = toResourcePath(settings.bundle.config.entryPoint);
  const result = await recompile(settings);

  JSON.stringify(result); //detect cycles etc;
  if (!result.messages.some(_ => _.type === "error")) {
    //verify the manifest
    const manifest = JSON.parse(fs.readFileSync(settings.bundle.outputpath + '/apmanifest.json').toString()) as AssetPackManifest;
    test.eq(1, manifest.version);
    if (!config.entryPoint.endsWith('.scss')) {
      test.assert(manifest.assets.find(file => file.subpath === 'ap.mjs' && !file.compressed && !file.sourcemap));
      test.eq(!dev, manifest.assets.some(file => file.subpath === 'ap.mjs.gz' && file.compressed && !file.sourcemap));
      test.eq(!dev, manifest.assets.some(file => file.subpath === 'ap.mjs.br' && file.compressed && !file.sourcemap));
    }

    manifest.assets.forEach(file => {
      const subpath = file.subpath;
      const fullpath = path.join(settings.bundle.outputpath, subpath.toLowerCase());
      if (!fs.existsSync(fullpath))
        throw new Error(`Missing file ${fullpath}`);
    });
  }

  for (const dep of result.fileDependencies) {
    if (dep.startsWith("//"))
      throw new Error(`Invalid depdenency path ${dep}`); //prefix '//' might leak through
    if (!fs.existsSync(toFSPath(dep, { allowUnmatched: true }) ?? dep))
      throw new Error(`Incorrectly claiming filedep ${dep} (missing extension?)`);
  }

  return {
    ...result,
    errors: result.messages.filter(_ => _.type === "error"),
    warnings: result.messages.filter(_ => _.type === "warning"),
    outputpath: settings.bundle.outputpath
  };
}

async function testConfigParser() {
  const packs = getYMLAssetPacks(await parseAndValidateModuleDefYMLText(`
assetPacks:
  dummy:
    entryPoint: webfeatures/dummy/dummy
`));

  test.eqPartial([
    {
      entryPoint: "mod::webhare_testsuite/webfeatures/dummy/dummy",
      supportedLanguages: [],
      whPolyfills: true,
    }
  ], packs);
}

async function testCompileerrors() {
  const baseconfig = getYMLAssetPacks(await parseAndValidateModuleDefYMLText(`
    assetPacks:
      adhoc:
        entryPoint: webfeatures/dummy/dummy
        supportedLanguages: [en, nl]
    `))[0];

  console.log("should properly detect broken scss");
  {
    const result = await compileAdhocTestBundle({ ...baseconfig, entryPoint: __dirname + "/broken-scss/broken-scss.es" }, true);
    test.assert(result.errors.length >= 1);
    test.assert(result.errors[0].message);

    test.eq(`mod::webhare_testsuite/tests/publisher/assetpacks/broken-scss/broken-scss.scss`, result.errors[0].resourcename);

    const filedeps = mapDepPaths(result.fileDependencies);
    test.assert(filedeps.includes(path.join(__dirname, "/broken-scss/broken-scss.scss")));
    test.assert(filedeps.includes(path.join(__dirname, "/broken-scss/broken-scss.es")));
    test.eq([], filedeps.filter(entry => entry[0] !== '/' && !entry.startsWith("mod::"))); //no weird entries, no 'stdin'...

    const missingdeps = mapDepPaths(result.missingDependencies);
    test.assert(missingdeps.length === 0);
  }

  console.log("should properly report relative broken imports");
  {
    const result = await compileAdhocTestBundle({ ...baseconfig, entryPoint: path.join(__dirname, "dependencies/simple-import-fail.es") }, true);
    test.assert(result.errors.length >= 1);
    test.assert(result.errors[0].message);
    test.assert(result.missingDependencies.includes("mod::webhare_testsuite/tests/publisher/assetpacks/dependencies/deeper/missing-here.ts"));
    test.assert(result.missingDependencies.includes("mod::webhare_testsuite/tests/publisher/assetpacks/dependencies/deeper/missing-here/index.tsx"));
    test.assert(result.missingDependencies.includes("mod::webhare_testsuite/tests/publisher/assetpacks/dependencies/deeper/missing-here/package.json"));
    test.assert(!result.missingDependencies.includes("mod::webhare_testsuite/tests/publisher/assetpacks/dependencies/missing-here.ts"));

    test.assert(result.missingDependencies.includes("mod::webhare_testsuite/tests/publisher/higher/higher-missing.tsx"));
  }

  console.log("should properly report broken location");
  {
    const result = await compileAdhocTestBundle({ ...baseconfig, entryPoint: path.join(__dirname, "dependencies/include-import-fail.es") }, true);
    test.assert(result.errors.length >= 1);
    test.assert(result.errors[0].message);

    test.eq(`mod::webhare_testsuite/tests/publisher/assetpacks/dependencies/deeper/import-fail.es`, result.errors[0].resourcename);

    const filedeps = mapDepPaths(result.fileDependencies);

    test.assert(filedeps.includes(path.join(__dirname, "dependencies/include-import-fail.es")));
    test.assert(filedeps.includes(path.join(__dirname, "dependencies/deeper/import-fail.es")));
    test.eq([], filedeps.filter(entry => entry[0] !== '/' && !entry.startsWith("mod::"))); //no weird entries, no 'stdin'...
  }

  console.log("looking for a nonexisting node_module should register missingDependencies on node_modules");
  {
    let result = await compileAdhocTestBundle({ ...baseconfig, entryPoint: path.join(__dirname, "dependencies/find-vendornamespace-module.es") }, true);

    test.assert(result.errors.length > 0);

    let missingdeps = mapDepPaths(result.missingDependencies);
    test.assert(missingdeps.includes(path.join(backendConfig.module.webhare_testsuite.root, "node_modules/@vendor/submodule")));
    test.assert(missingdeps.includes(path.join(backendConfig.module.webhare_testsuite.root, "node_modules/@vendor/submodule/index.js")));
    test.assert(missingdeps.includes(path.join(backendConfig.module.webhare_testsuite.root, "node_modules/@vendor/submodule/index.es")));
    test.assert(missingdeps.includes(path.join(backendConfig.module.webhare_testsuite.root, "node_modules/@vendor/submodule/package.json")));
    test.assert(missingdeps.includes(path.join(__dirname, "node_modules/@vendor/submodule")));
    test.assert(missingdeps.includes(path.join(__dirname, "node_modules/@vendor/submodule.js")));
    test.assert(missingdeps.includes(path.join(__dirname, "node_modules/@vendor/submodule.es")));
    test.assert(missingdeps.includes(path.join(__dirname, "node_modules/@vendor/submodule/index.js")));
    test.assert(missingdeps.includes(path.join(__dirname, "node_modules/@vendor/submodule/index.es")));
    test.assert(missingdeps.includes(path.join(__dirname, "node_modules/@vendor/submodule/package.json")));

    result = await compileAdhocTestBundle({ ...baseconfig, entryPoint: path.join(__dirname, "dependencies/find-vendornamespace-stylesheet.scss") }, true);
    test.assert(result.errors.length > 0);

    missingdeps = mapDepPaths(result.missingDependencies);
    test.assert(missingdeps.includes(path.join(backendConfig.module.webhare_testsuite.root, "node_modules/@vendor/submodule/my.scss")));
    test.assert(missingdeps.includes(path.join(__dirname, "node_modules/@vendor/submodule/my.scss")));
    test.assert(missingdeps.includes(path.join(__dirname, "node_modules/@vendor/submodule/my.scss.scss")));
    test.assert(missingdeps.includes(path.join(__dirname, "node_modules/@vendor/submodule/my.scss.sass")));

    result = await compileAdhocTestBundle({ ...baseconfig, entryPoint: path.join(__dirname, "dependencies/find-vendornamespace-stylesheet-singlequote.scss") }, true);
    test.assert(result.errors.length > 0);

    missingdeps = mapDepPaths(result.missingDependencies);
    test.assert(missingdeps.includes(path.join(backendConfig.module.webhare_testsuite.root, "node_modules/@vendor/submodule/my2.scss")));
    test.assert(missingdeps.includes(path.join(__dirname, "node_modules/@vendor/submodule/my2.scss")));
    test.assert(missingdeps.includes(path.join(__dirname, "node_modules/@vendor/submodule/my2.scss.scss")));
  }

  console.log("verify compression");
  {
    const result = await compileAdhocTestBundle({ ...baseconfig, entryPoint: __dirname + "/dependencies/chunks" }, false);
    test.assert(result.errors.length === 0);

    const filedeps = mapDepPaths(result.fileDependencies);
    // console.log(filedeps);
    test.assert(filedeps.includes(path.join(__dirname, "/dependencies/chunks.ts")));
    test.assert(filedeps.includes(path.join(__dirname, "/dependencies/async.ts")));
    test.assert(filedeps.includes(path.join(__dirname, "/dependencies/base-for-deps.es")));

    const manifest = JSON.parse(fs.readFileSync(result.outputpath + "/apmanifest.json").toString()) as AssetPackManifest;
    // console.log(manifest.assets);
    const chunks = manifest.assets.filter(file => file.subpath.match(/^async-.*mjs$/));
    test.eq(1, chunks.length, "Expecting only one additional chunk to be generated");
    const chunkAsBr = manifest.assets.find(file => file.subpath === chunks[0].subpath + ".br");
    test.assert(chunkAsBr);

    const origsource = fs.readFileSync(path.join(result.outputpath, chunks[0].subpath.toLowerCase())).toString();
    const decompressedsource = zlib.brotliDecompressSync(fs.readFileSync(path.join(result.outputpath, chunkAsBr.subpath.toLowerCase()))).toString();
    test.eq(origsource, decompressedsource);
  }

  console.log("browser override in package.json works");
  {
    const result = await compileAdhocTestBundle({ ...baseconfig, entryPoint: __dirname + "/data/browser-override" }, false);
    test.assert(result.errors.length === 0);

    const filedeps = mapDepPaths(result.fileDependencies);
    test.assert(filedeps.includes(path.join(__dirname, "/data/browser-override/test.browser.mjs")));
    test.assert(!filedeps.includes(path.join(__dirname, "/data/browser-override/test.mjs")));
  }

  console.log("Any package (or at least with ES files) includes the poyfill as dep (prod)");
  {
    const result = await compileAdhocTestBundle({ ...baseconfig, entryPoint: __dirname + "/dependencies/base-for-deps.es" }, false);
    test.assert(result.errors.length === 0);

    const filedeps = mapDepPaths(result.fileDependencies);
    test.assert(filedeps.includes(path.join(__dirname, "/dependencies/base-for-deps.es")));
    test.assert(filedeps.includes(path.join(backendConfig.installationRoot, "modules/publisher/js/internal/polyfills/all.ts")));
  }

  console.log("scss files dependencies");
  {
    const result = await compileAdhocTestBundle({ ...baseconfig, entryPoint: path.join(__dirname, "dependencies/regressions.scss") }, false);
    test.assert(result.errors.length === 0);

    const filedeps = mapDepPaths(result.fileDependencies);
    test.assert(filedeps.includes(path.join(__dirname, "/dependencies/regressions.scss")));
    test.assert(filedeps.includes(path.join(__dirname, "/dependencies/deeper/deeper.scss")));

    const css = fs.readFileSync(result.outputpath + "/ap.css").toString();
    const urls = [...css.matchAll(/(url\(.*\))/g)].map(_ => _[1]);
    test.assert(urls.length === 1);
    test.assert(urls[0].startsWith("url("));
    test.assert(!urls[0].startsWith("url(/"));
  }

  console.log("rpc.json files pull in system/js/wh/rpc.ts as dependency (prod)");
  {
    const result = await compileAdhocTestBundle({ ...baseconfig, entryPoint: __dirname + "/dependencies/base-for-deps.rpc.json" }, false);
    test.assert(result.errors.length === 0);

    const filedeps = mapDepPaths(result.fileDependencies);
    test.assert(filedeps.includes(path.join(__dirname, "/dependencies/base-for-deps.rpc.json")));
    test.assert(filedeps.includes(path.join(backendConfig.installationRoot, "modules/system/js/wh/rpc.ts")));
    test.assert(filedeps.includes(backendConfig.module.webhare_testsuite.root + "lib/webservicetest.whlib"));
  }

  console.log("lang.json files pull in extra dependencies");
  {
    const result = await compileAdhocTestBundle({ ...baseconfig, entryPoint: __dirname + "/dependencies/base-for-deps.lang.json" }, true);
    test.assert(result.errors.length === 0);

    const filedeps = mapDepPaths(result.fileDependencies);
    test.assert(filedeps.includes(path.join(__dirname, "/dependencies/base-for-deps.lang.json")));
    test.assert(filedeps.includes(path.join(backendConfig.installationRoot, "jssdk/gettid/src/internal.ts"))); //for registerTexts
    test.assert(filedeps.includes(path.join(backendConfig.installationRoot, "modules/tollium/language/default.xml")));
    test.assert(filedeps.includes(path.join(backendConfig.installationRoot, "modules/tollium/language/nl.xml")));
  }

  console.log("combine-deps pulls all these in as dependencies");
  {
    const result = await compileAdhocTestBundle({ ...baseconfig, entryPoint: __dirname + "/dependencies/combine-deps.es" }, true);
    console.log(result);
    test.assert(result.errors.length === 0);

    const filedeps = mapDepPaths(result.fileDependencies);

    test.assert(filedeps.includes(path.join(__dirname, "/dependencies/base-for-deps.es")));
    test.assert(filedeps.includes(path.join(__dirname, "/dependencies/base-for-deps.lang.json")));
    test.assert(filedeps.includes(path.join(__dirname, "/dependencies/base-for-deps.rpc.json")));
    test.assert(filedeps.includes(path.join(__dirname, "/dependencies/base-for-deps.scss")));
    test.assert(filedeps.includes(path.join(backendConfig.installationRoot, "modules/publisher/js/internal/polyfills/all.ts")));
    test.assert(filedeps.includes(path.join(backendConfig.installationRoot, "modules/system/js/wh/rpc.ts")));
    test.assert(filedeps.includes(path.join(backendConfig.installationRoot, "modules/tollium/language/default.xml")));
    test.assert(filedeps.includes(path.join(backendConfig.installationRoot, "jssdk/gettid/src/internal.ts"))); //for registerTexts
    test.assert(filedeps.includes(path.join(backendConfig.installationRoot, "modules/tollium/language/nl.xml")));
    test.assert(filedeps.includes(path.join(backendConfig.installationRoot, "modules/tollium/web/img/buttonbar/bulletedlist.16x16.b.svg")));

    const missingdeps = mapDepPaths(result.missingDependencies);
    test.assert(missingdeps.length === 0);
  }

  console.log("test other tricky dependencies");
  {
    const result = await compileAdhocTestBundle({ ...baseconfig, entryPoint: __dirname + "/dependencies/regressions.es" }, false);
    test.assert(result.errors.length === 0);

    const filedeps = mapDepPaths(result.fileDependencies);

    test.assert(filedeps.includes(path.join(backendConfig.installationRoot, "modules/system/js/dompack/browserfix/reset.css")));

    const css = fs.readFileSync(result.outputpath + "/ap.css").toString();
    test.assert(css.match(/.test2{.*margin-left:1px.*}/));
    test.assert(css.match(/.test3{.*margin-left:2px.*}/));
  }

  // Test for esbuild issue https://github.com/evanw/esbuild/issues/1657
  console.log("esbuild value collapse fix");
  {
    const result = await compileAdhocTestBundle({ ...baseconfig, entryPoint: path.join(__dirname, "optimizations/regressions.es") }, false);
    test.assert(result.errors.length === 0);

    // Older versions of esbuild collapsed global values, i.e.
    //    margin-bottom: 0;
    //    margin-left: unset;
    //    margin-right: unset;
    //    margin-top: 0;
    //   became
    //    margin: 0 unset;

    const css = fs.readFileSync(result.outputpath + "/ap.css").toString();
    test.assert(css.match(/.test1a{.*margin-left:unset.*}/));
    test.assert(css.match(/.test1a{.*padding-left:initial.*}/));
    // Check if numerical values are collapsed properly
    test.assert(css.match(/.test1b{.*margin:0 1% auto 1px.*}/));

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
    let result = await compileAdhocTestBundle({ ...baseconfig, entryPoint: __dirname + "/dependencies/typescript/test-typescript.ts" }, false);
    test.assert(result.errors.length === 0);

    const filedeps = mapDepPaths(result.fileDependencies);
    test.assert(filedeps.includes(path.join(__dirname, "/dependencies/typescript/test-typescript.ts")), 'test-typescript.ts');
    test.assert(filedeps.includes(path.join(__dirname, "/dependencies/typescript/test-typescript-2.ts")), 'test-typescript-2.ts'); // loaded by test-typescript.ts
    test.assert(filedeps.includes(path.join(__dirname, "/dependencies/typescript/folder/index.ts")), 'typescript/index.ts'); // loaded by test-typescript.ts
    test.assert(filedeps.includes(path.join(backendConfig.installationRoot, "modules/publisher/js/internal/polyfills/all.ts")));

    result = await compileAdhocTestBundle({ ...baseconfig, entryPoint: __dirname + "/dependencies/typescript/test-typescript-in-js.ts" }, false); //verify we cannot load TypeScript in JS
    test.assert(result.errors.length > 0);
  }

  console.log("TypeScript with jsx is working");
  {
    const result = await compileAdhocTestBundle({ ...baseconfig, entryPoint: __dirname + "/dependencies/typescript-jsx/test-typescript.tsx" }, false);
    test.assert(result.errors.length === 0);

    const filedeps = mapDepPaths(result.fileDependencies);
    test.assert(filedeps.includes(path.join(__dirname, "/dependencies/typescript-jsx/test-typescript.tsx")), 'test-typescript.tsx');
    test.assert(filedeps.includes(path.join(__dirname, "/dependencies/typescript-jsx/test-typescript-2.tsx")), 'test-typescript-2.tsx'); // loaded by test-typescript.tsx
    test.assert(filedeps.includes(path.join(__dirname, "/dependencies/typescript-jsx/folder/index.tsx")), 'typescript/index.tsx'); // loaded by test-typescript.tsx
    test.assert(filedeps.includes(path.join(backendConfig.installationRoot, "modules/publisher/js/internal/polyfills/all.ts")));
  }
}

async function testPlugins() {
  const packs = getYMLAssetPacks(await parseAndValidateModuleDefYMLText(`
  assetPacks:
    dummy:
      entryPoint: webfeatures/dummy/dummy
      esBuildPlugins:
      - plugin: node_modules/testplugin
      - plugin: node_modules/testplugin#loader
        pluginOptions:
        - regEx: "loadme"
      - plugin: node_modules/testplugin#default
        pluginOptions:
        - regEx: "\\\\.txt4$"
        - "ThisIsAPrefix:"
  `));

  test.eqPartial([
    {
      entryPoint: "mod::webhare_testsuite/webfeatures/dummy/dummy",
      supportedLanguages: [],
      whPolyfills: true,
    }
  ], packs);

  {
    const start = Date.now();
    const result = await compileAdhocTestBundle({ ...packs[0], entryPoint: __dirname + "/data/useplugin/useplugin.ts" }, true);
    console.log(result.errors);
    test.assert(result.errors.length === 0);

    const filedeps = mapDepPaths(result.fileDependencies);
    console.log(filedeps);
    test.assert(filedeps.includes(path.join(__dirname, "data/useplugin/h1.txt1")));
    test.assert(filedeps.includes(path.join(__dirname, "data/useplugin/h4.txt4")));

    //Run the script to ensure it made sense
    const spawnResult = child_process.spawnSync("node", [result.outputpath + "/ap.mjs"], { stdio: "pipe" });
    const parsedResult = JSON.parse(spawnResult.stdout.toString());
    test.eqPartial({
      h1: 'Test,one,begins,now,,Steps,unfold,with,steady,grace,,Truth,in,numbers,speaks,',
      h4: 'ThisIsAPrefix:Test,four,looms,ahead,,Quiet,minds,seek,hidden,truths,,Answers,soon,revealed.,',
      assetpacks: { "webhare_testsuite:dummy": (d: string) => Date.parse(d) >= start }
    }, parsedResult);

    const h7 = await (await fetch(backendConfig.backendURL + parsedResult.loadpath)).text();
    test.eq('Load this using fetch!', h7.trim());
  }
}


test.runTests([
  testConfigParser,
  testCompileerrors,
  testPlugins,
]);

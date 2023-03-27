import { map } from "./hmrlibs/keeper";
import * as test from "@webhare/test";
import * as fs from "fs";
import bridge from "@mod-system/js/internal/whmanager/bridge";
import { config } from "@mod-system/js/internal/configuration";
import { activate } from "@mod-system/js/internal/hmrinternal";
import { openHSVM, HSVM, HSVMObject } from "@webhare/services/src/hsvm";
import * as resourcetools from "@mod-system/js/internal/resourcetools";

async function testFileEdits() {

  // make sure the bridge is ready to receive events
  await bridge.ready;

  activate();

  const path_root = require.resolve("./hmrlibs/root.ts");
  const path_dep = require.resolve("./hmrlibs/dep.ts");
  const path_dep2 = require.resolve("./hmrlibs/dep2.ts");
  const path_dyn1 = require.resolve("./hmrlibs/dyn1.ts");
  const path_static = require.resolve("./hmrlibs/static.ts");
  const path_resource = require.resolve("./hmrlibs/resource.txt");

  // eslint-disable-next-line @typescript-eslint/no-var-requires -- TODO - our require plugin doesn't support await import yet
  const { dynimport } = require(path_root);

  await dynimport(path_dyn1);

  test.eq({
    "root.ts": 1,
    "dep.ts": 2,
    "dyn1.ts": 3,
  }, map);


  test.assert(require.cache[path_root]);
  test.assert(require.cache[path_dyn1]);
  test.assert(require.cache[path_root]);

  test.assert(require.cache[path_dep]);
  fs.writeFileSync(path_dep, fs.readFileSync(path_dep, "utf-8"), "utf-8");

  await test.wait(async () => !require.cache[path_dep]);
  test.assert(!require.cache[path_dyn1]);
  test.assert(require.cache[path_root]);

  await dynimport(path_dyn1);

  test.eq({
    "root.ts": 1,
    "dep.ts": 4,
    "dyn1.ts": 5,
  }, map);

  await dynimport(path_static);
  test.eq({
    "root.ts": 1,
    "dep.ts": 4,
    "dyn1.ts": 5,
    "dep2.ts": 6,
    "static.ts": 7
  }, map);

  fs.writeFileSync(path_dep2, fs.readFileSync(path_dep2, "utf-8"), "utf-8");

  await test.wait(async () => !require.cache[path_dep2]);
  test.assert(require.cache[path_static]);

  await dynimport(path_static);
  test.eq({
    "root.ts": 1,
    "dep.ts": 4,
    "dyn1.ts": 5,
    "dep2.ts": 6,
    "static.ts": 7
  }, map);

  // Update a resource marked as loaded by dyn1
  fs.writeFileSync(path_resource, fs.readFileSync(path_resource, "utf-8"), "utf-8");

  await test.wait(async () => !require.cache[path_dyn1]);
  await dynimport(path_dyn1);

  test.eq({
    "root.ts": 1,
    "dep.ts": 4,
    "dyn1.ts": 8,
    "dep2.ts": 6,
    "static.ts": 7
  }, map);
}

async function createModule(hsvm: HSVM, name: string, files: Record<string, string>) {
  const archive = await hsvm.loadlib("mod::system/whlibs/filetypes/archiving.whlib").CreateNewArchive("application/zip") as HSVMObject;
  for (const [path, data] of Object.entries(files)) {
    await archive.AddFile(name + "/" + path, Buffer.from(data), new Date);
  }
  const modulearchive = await archive.MakeBlob();
  const res = await hsvm.loadlib("mod::system/lib/internal/moduleimexport.whlib").ImportModule(modulearchive);
  console.log(`installed ${name} to ${(res as { path: string }).path}`);
}

async function testModuleReplacement() {
  const hsvm = await openHSVM();
  await hsvm.loadlib("mod::system/lib/database.whlib").OpenPrimary();

  if (config.module["webhare_testsuite_hmrtest"]) {
    console.log(`delete module webhare_testsuite_hmrtest`);
    if (!await hsvm.loadlib("mod::system/lib/internal/moduleimexport.whlib").DeleteModule("webhare_testsuite_hmrtest"))
      throw new Error(`Could not delete module "webhare_testsuite_hmrtest"`);
  }

  if (config.module["webhare_testsuite_hmrtest2"]) {
    console.log(`delete module webhare_testsuite_hmrtest2`);
    if (!await hsvm.loadlib("mod::system/lib/internal/moduleimexport.whlib").DeleteModule("webhare_testsuite_hmrtest2"))
      throw new Error(`Could not delete module "webhare_testsuite_hmrtest2"`);
  }

  console.log(`create module webhare_testsuite_hmrtest`);
  await createModule(hsvm, "webhare_testsuite_hmrtest", {
    "moduledefinition.xml": `<?xml version="1.0"?>
<module xmlns="http://www.webhare.net/xmlns/system/moduledefinition">
  <meta>
    <version>0.0.1</version>
  </meta>
</module>`,
    "js/file.ts": `export function func() { return 1; }; console.log("load file 1");`
  });

  console.log(`create module webhare_testsuite_hmrtest2`);
  await createModule(hsvm, "webhare_testsuite_hmrtest2", {
    "moduledefinition.xml": `<?xml version="1.0"?>
<module xmlns="http://www.webhare.net/xmlns/system/moduledefinition">
  <meta>
    <version>0.0.1</version>
  </meta>
</module>`,
    "js/file2.ts": `import { func } from "@mod-webhare_testsuite_hmrtest/js/file"; export function func2() { return func(); }`
  });

  test.eq(1, (await resourcetools.loadJSFunction("mod::webhare_testsuite_hmrtest/js/file.ts#func"))());
  test.eq(1, (await resourcetools.loadJSFunction("mod::webhare_testsuite_hmrtest2/js/file2.ts#func2"))());
  const orgpath = config.module["webhare_testsuite_hmrtest"].root;

  console.log(`create 2nd version of module webhare_testsuite_hmrtest`);
  await createModule(hsvm, "webhare_testsuite_hmrtest", {
    "moduledefinition.xml": `<?xml version="1.0"?>
<module xmlns="http://www.webhare.net/xmlns/system/moduledefinition">
  <meta>
    <version>0.0.2</version>
  </meta>
</module>`,
    "js/file.ts": `export function func() { return 2; }; console.log("load file 2");`
  });

  test.assert(orgpath !== config.module["webhare_testsuite_hmrtest"].root, `new path ${config.module["webhare_testsuite_hmrtest"].root} should differ from old path ${orgpath}`);
  test.eq(2, (await resourcetools.loadJSFunction("mod::webhare_testsuite_hmrtest/js/file.ts#func"))());
  test.eq(2, (await resourcetools.loadJSFunction("mod::webhare_testsuite_hmrtest2/js/file2.ts#func2"))());

  if (!await hsvm.loadlib("mod::system/lib/internal/moduleimexport.whlib").DeleteModule("webhare_testsuite_hmrtest"))
    throw new Error(`Could not delete module "webhare_testsuite_hmrtest"`);
  if (!await hsvm.loadlib("mod::system/lib/internal/moduleimexport.whlib").DeleteModule("webhare_testsuite_hmrtest2"))
    throw new Error(`Could not delete module "webhare_testsuite_hmrtest2"`);

}

test.run([
  testFileEdits,
  testModuleReplacement
]);

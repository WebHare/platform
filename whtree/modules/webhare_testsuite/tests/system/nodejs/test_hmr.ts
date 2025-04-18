import { map } from "./hmrlibs/keeper";
import * as test from "@webhare/test";
import * as fs from "fs";
import bridge from "@mod-system/js/internal/whmanager/bridge";
import { toFSPath, backendConfig, importJSFunction } from "@webhare/services";
import { addResourceChangeListener, activateHMR } from "@webhare/services/src/hmr";
import { storeDiskFile } from "@webhare/system-tools";
import { deleteTestModule, installTestModule } from "@mod-webhare_testsuite/js/config/testhelpers";

type HMRTestFunction = () => number;

async function testFileEdits() {

  // make sure the bridge is ready to receive events
  await bridge.ready;

  activateHMR();

  const path_root = require.resolve("./hmrlibs/root.ts");
  const path_dep = require.resolve("./hmrlibs/dep.ts");
  const path_dep2 = require.resolve("./hmrlibs/dep2.ts");
  const path_dyn1 = require.resolve("./hmrlibs/dyn1.ts");
  const path_static = require.resolve("./hmrlibs/static.ts");
  const path_resource = require.resolve("./hmrlibs/resource.txt");

  // eslint-disable-next-line @typescript-eslint/no-require-imports -- TODO - our require plugin doesn't support await import yet
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

  // Rewrite via rename, linux picks up multiple events when writing directly with writeFileSync
  await storeDiskFile(path_dep, fs.readFileSync(path_dep, "utf-8"), { overwrite: true });

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

  await storeDiskFile(path_dep2, fs.readFileSync(path_dep2, "utf-8"), { overwrite: true });

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
  await storeDiskFile(path_resource, fs.readFileSync(path_resource, "utf-8"), { overwrite: true });

  await test.wait(async () => !require.cache[path_dyn1]);
  await dynimport(path_dyn1);

  test.eq({
    "root.ts": 1,
    "dep.ts": 4,
    "dyn1.ts": 8,
    "dep2.ts": 6,
    "static.ts": 7
  }, map);

  // test callbacks
  const stateTest = { count: 0 };
  addResourceChangeListener(module, path_resource, () => {
    stateTest.count++;
  });
  await storeDiskFile(path_resource, fs.readFileSync(path_resource, "utf-8"), { overwrite: true });
  await test.wait(() => stateTest.count === 1);
}

async function testModuleReplacement() {
  if (backendConfig.module["webhare_testsuite_hmrtest"]) {
    console.log(`delete module webhare_testsuite_hmrtest`);
    await deleteTestModule("webhare_testsuite_hmrtest");
  }

  if (backendConfig.module["webhare_testsuite_hmrtest2"]) {
    console.log(`delete module webhare_testsuite_hmrtest2`);
    await deleteTestModule("webhare_testsuite_hmrtest2");
  }

  console.log(`create module webhare_testsuite_hmrtest`);
  const hmrtestresult = await installTestModule("webhare_testsuite_hmrtest", {
    "moduledefinition.xml": `<?xml version="1.0"?>
<module xmlns="http://www.webhare.net/xmlns/system/moduledefinition">
  <meta>
    <version>0.0.1</version>
  </meta>
</module>`,
    "js/file.ts": `export function func() { return 1; }; console.log("load file 1");`,
    "js/data.txt": `1`
  });

  console.log(`create module webhare_testsuite_hmrtest2`);
  const hmrtestresult2 = await installTestModule("webhare_testsuite_hmrtest2", {
    "moduledefinition.xml": `<?xml version="1.0"?>
<module xmlns="http://www.webhare.net/xmlns/system/moduledefinition">
  <meta>
    <version>0.0.1</version>
  </meta>
</module>`,
    "js/file2.ts": `import { func } from "@mod-webhare_testsuite_hmrtest/js/file"; export function func2() { return func(); }`,
    "js/file3.ts": `import { registerResourceDependency } from "@webhare/services";
import { toFSPath } from "@webhare/services";
import * as fs from "node:fs";
const fspath = toFSPath("mod::webhare_testsuite_hmrtest/js/data.txt");
const file = fs.readFileSync(fspath).toString();
registerResourceDependency(module, fspath);
export function func3() { return Number(file.trim()); }
`
  });

  const loaderfilepath = backendConfig.installationRoot + "jssdk/services/src/resourcetools.ts";

  test.assert(!Object.hasOwn(require.cache, toFSPath("mod::webhare_testsuite_hmrtest/js/file.ts")));
  test.assert(!Object.hasOwn(require.cache, toFSPath("mod::webhare_testsuite_hmrtest2/js/file2.ts")));

  test.eq(1, (await importJSFunction<HMRTestFunction>("mod::webhare_testsuite_hmrtest/js/file.ts#func"))());
  test.eq(1, (await importJSFunction<HMRTestFunction>("mod::webhare_testsuite_hmrtest2/js/file2.ts#func2"))());
  test.eq(1, (await importJSFunction<HMRTestFunction>("mod::webhare_testsuite_hmrtest2/js/file3.ts#func3"))());
  const orgpath = backendConfig.module["webhare_testsuite_hmrtest"].root;
  test.eq(hmrtestresult.path + '/', orgpath); //not sure if ImportModule should be returning without slash, but not modifying any APIs right now if we don't have to
  test.eq(hmrtestresult2.path + '/', backendConfig.module["webhare_testsuite_hmrtest2"].root);

  test.assert(Object.hasOwn(require.cache, toFSPath("mod::webhare_testsuite_hmrtest/js/file.ts")));
  test.assert(Object.hasOwn(require.cache, toFSPath("mod::webhare_testsuite_hmrtest2/js/file2.ts")));
  test.assert(Object.hasOwn(require.cache, toFSPath("mod::webhare_testsuite_hmrtest2/js/file3.ts")));
  test.eq(1, require.cache[loaderfilepath]?.children.filter(({ id }) => id === toFSPath("mod::webhare_testsuite_hmrtest/js/file.ts")).length);
  test.eq(1, require.cache[loaderfilepath]?.children.filter(({ id }) => id === toFSPath("mod::webhare_testsuite_hmrtest2/js/file2.ts")).length);
  test.eq(1, require.cache[loaderfilepath]?.children.filter(({ id }) => id === toFSPath("mod::webhare_testsuite_hmrtest2/js/file3.ts")).length);

  console.log(`create 2nd version of module webhare_testsuite_hmrtest`);
  const hmrtestresult_reupload = await installTestModule("webhare_testsuite_hmrtest", {
    "moduledefinition.xml": `<?xml version="1.0"?>
<module xmlns="http://www.webhare.net/xmlns/system/moduledefinition">
  <meta>
    <version>0.0.2</version>
  </meta>
</module>`,
    "js/file.ts": `export function func() { return 2; }; console.log("load file 2");`,
    "js/data.txt": `2`
  });
  console.log(hmrtestresult_reupload);

  // All modules referencing file.ts should be removed from the cache
  test.assert(!Object.hasOwn(require.cache, toFSPath("mod::webhare_testsuite_hmrtest/js/file.ts")));
  test.assert(!Object.hasOwn(require.cache, toFSPath("mod::webhare_testsuite_hmrtest2/js/file2.ts")));
  test.assert(!Object.hasOwn(require.cache, toFSPath("mod::webhare_testsuite_hmrtest2/js/file3.ts")));
  test.eq(0, require.cache[loaderfilepath]?.children.filter(({ id }) => id === toFSPath("mod::webhare_testsuite_hmrtest/js/file.ts")).length);
  test.eq(0, require.cache[loaderfilepath]?.children.filter(({ id }) => id === toFSPath("mod::webhare_testsuite_hmrtest2/js/file2.ts")).length);
  test.eq(0, require.cache[loaderfilepath]?.children.filter(({ id }) => id === toFSPath("mod::webhare_testsuite_hmrtest2/js/file3.ts")).length);

  test.eq(hmrtestresult_reupload.path + '/', backendConfig.module["webhare_testsuite_hmrtest"].root, "Path in config object should have been updated");
  test.assert(orgpath !== backendConfig.module["webhare_testsuite_hmrtest"].root, `new path ${backendConfig.module["webhare_testsuite_hmrtest"].root} should differ from old path ${orgpath}`);
  test.eq(2, (await importJSFunction<HMRTestFunction>("mod::webhare_testsuite_hmrtest/js/file.ts#func"))());
  test.eq(2, (await importJSFunction<HMRTestFunction>("mod::webhare_testsuite_hmrtest2/js/file2.ts#func2"))(), "Recursive invalidation of modules should work, resolve cache and realpath cache should also be cleared");
  test.eq(2, (await importJSFunction<HMRTestFunction>("mod::webhare_testsuite_hmrtest2/js/file3.ts#func3"))(), "Invalidation by loaded resources should work");

  test.assert(Object.hasOwn(require.cache, toFSPath("mod::webhare_testsuite_hmrtest/js/file.ts")));
  test.assert(Object.hasOwn(require.cache, toFSPath("mod::webhare_testsuite_hmrtest2/js/file2.ts")));
  test.assert(Object.hasOwn(require.cache, toFSPath("mod::webhare_testsuite_hmrtest2/js/file3.ts")));

  await deleteTestModule("webhare_testsuite_hmrtest");
  await deleteTestModule("webhare_testsuite_hmrtest2");
}

test.runTests([
  testFileEdits,
  testModuleReplacement
]);

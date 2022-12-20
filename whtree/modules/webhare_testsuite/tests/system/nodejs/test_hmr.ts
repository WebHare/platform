import { map } from "./hmrlibs/keeper";
import * as test from "@webhare/test";
import * as fs from "fs";
import bridge from "@mod-system/js/internal/whmanager/bridge";
import { activate } from "@mod-system/js/internal/hmrinternal";

async function testHMR() {

  // make sure the bridge is ready to receive events
  await bridge.ready;

  activate();

  const path_root = require.resolve("./hmrlibs/root.ts");
  const path_dep = require.resolve("./hmrlibs/dep.ts");
  const path_dep2 = require.resolve("./hmrlibs/dep2.ts");
  const path_dyn1 = require.resolve("./hmrlibs/dyn1.ts");
  const path_static = require.resolve("./hmrlibs/static.ts");

  const { dynimport } = await import(path_root);
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


}

test.run([testHMR]);

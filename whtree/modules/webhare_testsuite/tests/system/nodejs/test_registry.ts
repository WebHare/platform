import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { loadlib } from "@webhare/harescript";
import { readRegistryKey, writeRegistryKey, getRegistryKeyEventMasks, WebHareBlob, readRegistryNode } from "@webhare/services";
import { deleteRegistryKey, deleteRegistryNode, readRegistryKeysByMask, splitRegistryKey } from "@webhare/services/src/registry";
import { Money } from "@webhare/std";
import * as test from "@webhare/test-backend";
import { beginWork, commitWork, db } from "@webhare/whdb";

function testLowLevel() {
  test.eq({
    userprefix: "<overrideuser>.", module: "system", sep: ":", subnode: "node.subnode.", subkey: "subkey",
    storenode: "<overrideuser>.system.node.subnode."
  }, splitRegistryKey("<overrideuser>.system:node.subnode.subkey"));
  test.eq({
    userprefix: "<overrideuser>.", module: "tollium", sep: ".", subnode: "savestate.", subkey: "150995d2891cb9d2982c8a82b5756ff6",
    storenode: "<overrideuser>.tollium.savestate."
  }, splitRegistryKey("<overrideuser>.tollium.savestate.150995d2891cb9d2982c8a82b5756ff6"));
  test.eq({
    userprefix: "", module: "webhare_testsuite_base_node", sep: ".", subnode: "", subkey: "stupidvalue",
    storenode: "webhare_testsuite_base_node."
  }, splitRegistryKey("webhare_testsuite_base_node.stupidvalue"));

  test.throws(/Invalid registry key name/, () => splitRegistryKey("system.servicemanager.runonce.consilio:migrate_indices_v3"));
  test.eq({
    userprefix: "", module: "system", sep: ".", subnode: "servicemanager.runonce.", subkey: "consilio:migrate_indices_v3",
    storenode: "system.servicemanager.runonce."
  }, splitRegistryKey("system.servicemanager.runonce.consilio:migrate_indices_v3", { acceptInvalidKeyNames: true }));
}

async function doKeyTests(basename: string, { acceptInvalidKeyNames = false } = {}) {
  const foruser = basename.startsWith("<");
  //Read&Write have different responses to non existing keys whether is system or user registry, as one requires values to exist and the other requires fallback values to be provided
  await test.throws(foruser ? /Reading a user registry requires/ : /No such registry key/, () => readRegistryKey<number>(basename + "webhare_testsuite_base_node.stupidvalue", undefined, { acceptInvalidKeyNames }));
  test.eq(43, await readRegistryKey(basename + "webhare_testsuite_base_node.stupidvalue", 43, { acceptInvalidKeyNames }));
  await test.throws(foruser ? /Writing a user registry requires/ : /No such registry key/, () => writeRegistryKey(basename + "webhare_testsuite_base_node.stupidvalue", 43));
  await writeRegistryKey(basename + "webhare_testsuite_base_node.stupidvalue", 44, { createIfNeeded: true });
  test.eq(44, await readRegistryKey(basename + "webhare_testsuite_base_node.stupidvalue", 43, { acceptInvalidKeyNames }));
  await writeRegistryKey(basename + "webhare_testsuite_base_node.stupidvalue", 45, { createIfNeeded: true });
  test.eq(45, await readRegistryKey(basename + "webhare_testsuite_base_node.stupidvalue", 43, { acceptInvalidKeyNames }));
  await writeRegistryKey(basename + "webhare_testsuite_base_node.stupidvalue", 46, { initialCreate: true });
  test.eq(45, await readRegistryKey(basename + "webhare_testsuite_base_node.stupidvalue", 43, { acceptInvalidKeyNames }));

  test.eq([{ name: basename + "webhare_testsuite_base_node.stupidvalue", value: 45 }], await readRegistryKeysByMask(basename + "webhare_testsuite_base_node.stupidvalue"));

  await writeRegistryKey(basename + "webhare_testsuite_base_node.blobvalue", WebHareBlob.from("Hello, World!"), { createIfNeeded: true });
  test.eq("Hello, World!", await (await readRegistryKey<WebHareBlob>(basename + "webhare_testsuite_base_node.blobvalue", WebHareBlob.from(""), { acceptInvalidKeyNames })).text());

  await writeRegistryKey(basename + "webhare_testsuite_base_node.blobvalue", WebHareBlob.from("Hello, World!".repeat(1000)), { createIfNeeded: true });
  test.eq("Hello, World!".repeat(1000), await (await readRegistryKey<WebHareBlob>(basename + "webhare_testsuite_base_node.blobvalue", WebHareBlob.from(""), { acceptInvalidKeyNames })).text());

  {
    const node = (await readRegistryNode(basename + "webhare_testsuite_base_node")).toSorted((lhs, rhs) => lhs.fullname.localeCompare(rhs.fullname));
    test.eqPartial([
      { fullname: basename + "webhare_testsuite_base_node.blobvalue", subkey: "blobvalue" },
      { fullname: basename + "webhare_testsuite_base_node.stupidvalue", subkey: "stupidvalue", data: 45 }
    ], node);
    test.eq("Hello, World!".repeat(1000), await (node[0].data as WebHareBlob).text());
  }

  await deleteRegistryKey(basename + "webhare_testsuite_base_node.stupidvalue");
  await test.throws(foruser ? /Reading a user registry requires/ : /No such registry key/, () => readRegistryKey<number>(basename + "webhare_testsuite_base_node.stupidvalue", undefined, { acceptInvalidKeyNames }));
  test.eqPartial([
    {
      fullname: basename + "webhare_testsuite_base_node.blobvalue", subkey: "blobvalue"
    }
  ], (await readRegistryNode(basename + "webhare_testsuite_base_node")).toSorted((lhs, rhs) => lhs.fullname.localeCompare(rhs.fullname)));
  test.eq(47, await readRegistryKey(basename + "webhare_testsuite_base_node.stupidvalue", 47, { acceptInvalidKeyNames }));

  await writeRegistryKey(basename + "webhare_testsuite_base_node.stupidvalue", 48, { initialCreate: true });
  await deleteRegistryNode(basename + "webhare_testsuite_base_node");
  test.eq([], await readRegistryNode(basename + "webhare_testsuite_base_node"));
}

async function testRegistry() {
  await readRegistryKey("system:backend.development.manualdebugmgr");
  await readRegistryKey("system:backend.development.manualdebugmgr");

  test.eq(['system:registry.webhare_testsuite.x3', 'system:registry.webhare_testsuite.y1'], getRegistryKeyEventMasks(["webhare_testsuite.y1.testkey", "webhare_testsuite.y1.testkey2", "webhare_testsuite.x3.testkey"]));
  test.eq(['system:registry.webhare_testsuite.x3', 'system:registry.webhare_testsuite.y1'], getRegistryKeyEventMasks(["webhare_testsuite:y1.testkey", "webhare_testsuite.y1.testkey2", "webhare_testsuite:x3.testkey"]));
  test.eq(['system:registry.webhare_testsuite'], getRegistryKeyEventMasks(["webhare_testsuite:topkey"]));
  test.throws(/Invalid registry key name/, () => getRegistryKeyEventMasks(["webhare_testsuite"]));
  await test.throws(/Invalid registry key name/, () => readRegistryKey("<anonymous>", 42));

  await beginWork();

  //cleanup. we'll use a special name so we can safely destroy it from the registry unseen
  await db<PlatformDB>().deleteFrom("system.flatregistry").where("name", "like", "%webhare_testsuite_base_node%").execute();

  await doKeyTests("webhare_testsuite.");
  await doKeyTests("webhare_testsuite:");
  await doKeyTests("webhare_testsuite.withdeepcolon:", { acceptInvalidKeyNames: true }); //eg ensure 'system.servicemanager.runonce.consilio:migrate_indices_v3' - works
  await doKeyTests("<wrd:00001111222233334444555566667777>.webhare_testsuite.");
  await doKeyTests("<wrd:00001111222233334444555566667777>.webhare_testsuite:");
  await doKeyTests("<wrd:00001111222233334444555566667a7a>.webhare_testsuite:");
  await doKeyTests("<wrd:00001111222233334444555566667a7a>.webhare_testsuite:");

  await test.throws(/Invalid registry key name/, () => readRegistryKey("<someuser>:webhare_testsuite.key", true));
  await test.throws(/Invalid registry key name/, () => readRegistryKey("<wrd:00001111222233334444555566667A7A>:webhare_testsuite.key", true));
  await test.throws(/Invalid registry key name/, () => readRegistryKey("<someuser>.webhare_testsuite.key", true));
  await test.throws(/Invalid registry key name/, () => readRegistryKey("<wrd:00001111222233334444555566667A7A>.webhare_testsuite.key", true));

  await test.throws(/Invalid registry key name/, () => writeRegistryKey("modules.webhare_testsuite", true));
  await test.throws(/Invalid registry key name/, () => writeRegistryKey("system.modules.webhare_testsuite", true));

  await test.throws(/No such registry/, () => readRegistryKey<number>("webhare_testsuite.webhare_testsuite_base_node.stupidvalue"));
  await writeRegistryKey("webhare_testsuite.webhare_testsuite_base_node.stupidvalue", 43, { createIfNeeded: true });
  //@ts-expect-error -- requires a type parameter
  test.eq(43, await readRegistryKey("webhare_testsuite.webhare_testsuite_base_node.stupidvalue"));
  //@ts-expect-error -- requires a type parameter as we never declared the stupidvalue regkey
  test.eq(43, await readRegistryKey("webhare_testsuite:webhare_testsuite_base_node.stupidvalue"));
  test.eq(43, await readRegistryKey("webhare_testsuite.webhare_testsuite_base_node.stupidvalue", 43));
  await test.throws(/Invalid type/, () => readRegistryKey("webhare_testsuite.webhare_testsuite_base_node.stupidvalue", Money.fromNumber(43)));

  await writeRegistryKey("webhare_testsuite:webhare_testsuite_base_node.stupidvalue", 44);
  test.eq(44, await readRegistryKey<number>("webhare_testsuite.webhare_testsuite_base_node.stupidvalue"));

  test.eq([{ fullname: "webhare_testsuite.webhare_testsuite_base_node.stupidvalue", subkey: "stupidvalue", data: 44 }], await readRegistryNode("webhare_testsuite.webhare_testsuite_base_node"));
  await deleteRegistryKey("webhare_testsuite.webhare_testsuite_base_node.stupidvalue");
  await test.throws(/No such registry key/, () => readRegistryKey<number>("webhare_testsuite.webhare_testsuite_base_node.stupidvalue"));
  await test.throws(/No such registry key/, () => readRegistryKey<number>("webhare_testsuite:webhare_testsuite_base_node.stupidvalue"));

  await writeRegistryKey("webhare_testsuite:webhare_testsuite_base_node.stupidvalue", 45, { createIfNeeded: true });
  test.eq(45, await readRegistryKey<number>("webhare_testsuite.webhare_testsuite_base_node.stupidvalue"));
  await deleteRegistryKey("webhare_testsuite:webhare_testsuite_base_node.stupidvalue");
  await test.throws(/No such registry key/, () => readRegistryKey<number>("webhare_testsuite:webhare_testsuite_base_node.stupidvalue"));

  await commitWork();

  //NOTE: Mocking registry keys (MockRegistryKey/MockRegistryKey) was rarely used so we won't port that to TS.
}

async function testModuleDefs() {
  await beginWork();
  await writeRegistryKey("webhare_testsuite:registrytests.removekey", 42, { initialCreate: true });
  await writeRegistryKey("webhare_testsuite.registrytests.removenode.subkey", 43, { initialCreate: true });
  await commitWork();

  test.eq(42, await readRegistryKey<number>("webhare_testsuite.registrytests.removekey"));
  test.eq(43, await readRegistryKey<number>("webhare_testsuite.registrytests.removenode.subkey"));

  test.eq([], (await loadlib("mod::system/lib/internal/modules/moduleregistry.whlib").initModuleRegistryKeys(["webhare_testsuite"])).commitmessages);

  test.eq(0, await readRegistryKey("webhare_testsuite.registrytests.removekey", 0));
  test.eq(0, await readRegistryKey("webhare_testsuite.registrytests.removenode.subkey", 0));
}

test.runTests([
  testLowLevel,
  testRegistry,
  testModuleDefs
]);

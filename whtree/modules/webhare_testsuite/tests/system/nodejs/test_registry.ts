import type { PlatformDB } from "@mod-platform/generated/whdb/platform";
import { loadlib } from "@webhare/harescript";
import { readRegistryKey, writeRegistryKey, getRegistryKeyEventMasks, WebHareBlob, readRegistryNode } from "@webhare/services";
import { deleteRegistryKey, deleteRegistryNode, readRegistryKeysByMask } from "@webhare/services/src/registry";
import { Money } from "@webhare/std";
import * as test from "@webhare/test-backend";
import { beginWork, commitWork, db, rollbackWork } from "@webhare/whdb";

async function doKeyTests(basename: string) {
  const foruser = basename.startsWith("<");
  //Read&Write have different responses to non existing keys whether is system or user registry, as one requires values to exist and the other requires fallback values to be provided
  await test.throws(foruser ? /Reading a user registry requires/ : /No such registry key/, () => readRegistryKey<number>(basename + "webhare_testsuite_base_node.stupidvalue"));
  test.eq(43, await readRegistryKey(basename + "webhare_testsuite_base_node.stupidvalue", 43));
  await test.throws(foruser ? /Writing a user registry requires/ : /No such registry key/, () => writeRegistryKey(basename + "webhare_testsuite_base_node.stupidvalue", 43));
  await writeRegistryKey(basename + "webhare_testsuite_base_node.stupidvalue", 44, { createIfNeeded: true });
  test.eq(44, await readRegistryKey(basename + "webhare_testsuite_base_node.stupidvalue", 43));
  await writeRegistryKey(basename + "webhare_testsuite_base_node.stupidvalue", 45, { createIfNeeded: true });
  test.eq(45, await readRegistryKey(basename + "webhare_testsuite_base_node.stupidvalue", 43));
  await writeRegistryKey(basename + "webhare_testsuite_base_node.stupidvalue", 46, { initialCreate: true });
  test.eq(45, await readRegistryKey(basename + "webhare_testsuite_base_node.stupidvalue", 43));

  test.eq([{ name: basename + "webhare_testsuite_base_node.stupidvalue", value: 45 }], await readRegistryKeysByMask(basename + "webhare_testsuite_base_node.stupidvalue"));

  await writeRegistryKey(basename + "webhare_testsuite_base_node.blobvalue", WebHareBlob.from("Hello, World!"), { createIfNeeded: true });
  test.eq("Hello, World!", await (await readRegistryKey<WebHareBlob>(basename + "webhare_testsuite_base_node.blobvalue", WebHareBlob.from(""))).text());

  await writeRegistryKey(basename + "webhare_testsuite_base_node.blobvalue", WebHareBlob.from("Hello, World!".repeat(1000)), { createIfNeeded: true });
  test.eq("Hello, World!".repeat(1000), await (await readRegistryKey<WebHareBlob>(basename + "webhare_testsuite_base_node.blobvalue", WebHareBlob.from(""))).text());

  {
    const node = (await readRegistryNode(basename + "webhare_testsuite_base_node")).toSorted((lhs, rhs) => lhs.fullname.localeCompare(rhs.fullname));
    test.eqPartial([
      { fullname: basename + "webhare_testsuite_base_node.blobvalue", subkey: "blobvalue" },
      { fullname: basename + "webhare_testsuite_base_node.stupidvalue", subkey: "stupidvalue", data: 45 }
    ], node);
    test.eq("Hello, World!".repeat(1000), await (node[0].data as WebHareBlob).text());
  }

  await deleteRegistryKey(basename + "webhare_testsuite_base_node.stupidvalue");
  await test.throws(foruser ? /Reading a user registry requires/ : /No such registry key/, () => readRegistryKey<number>(basename + "webhare_testsuite_base_node.stupidvalue"));
  test.eqPartial([
    {
      fullname: basename + "webhare_testsuite_base_node.blobvalue", subkey: "blobvalue"
    }
  ], (await readRegistryNode(basename + "webhare_testsuite_base_node")).toSorted((lhs, rhs) => lhs.fullname.localeCompare(rhs.fullname)));
  test.eq(47, await readRegistryKey(basename + "webhare_testsuite_base_node.stupidvalue", 47));

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

  await beginWork();

  //cleanup. we'll use a special name so we can safely destroy it from the registry unseen
  await db<PlatformDB>().deleteFrom("system.flatregistry").where("name", "like", "%webhare_testsuite_base_node%").execute();

  await doKeyTests("webhare_testsuite.");
  await doKeyTests("webhare_testsuite:");
  await doKeyTests("webhare_testsuite.withdeepcolon:"); //eg ensure 'system.servicemanager.runonce.consilio:migrate_indices_v3' - works
  await doKeyTests("<wrd:00001111222233334444555566667777>.webhare_testsuite.");
  await doKeyTests("<wrd:00001111222233334444555566667777>.webhare_testsuite:");
  await test.throws(/Invalid registry key name/, () => readRegistryKey("<someuser>:webhare_testsuite.key", true));

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

async function testAnonymousRegistry() {
  await beginWork();

  test.eq([], await db<PlatformDB>().selectFrom("system.flatregistry").select("id").where("name", "like", "%webhare_testsuite_base_node%").execute());
  await doKeyTests("<anonymous>.");
  test.eq([], await db<PlatformDB>().selectFrom("system.flatregistry").select("id").where("name", "like", "%webhare_testsuite_base_node%").execute());

  await rollbackWork();
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
  testRegistry,
  testAnonymousRegistry,
  testModuleDefs
]);

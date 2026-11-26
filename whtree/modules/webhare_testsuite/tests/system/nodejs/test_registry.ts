import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { loadlib } from "@webhare/harescript";
import { defaultDateTime } from "@webhare/hscompat";
import { getTypedArray, HareScriptType } from "@webhare/hscompat/src/hson";
import { readRegistryKey, writeRegistryKey, getRegistryKeyEventMasks, WebHareBlob, readRegistryNode, type RegistryKeyOfType } from "@webhare/services";
import { deleteRegistryKey, deleteRegistryNode, signalOnRegistryKeyChange, splitRegistryKey } from "@webhare/services/src/registry";
import { Money } from "@webhare/std";
import * as test from "@webhare/test-backend";
import { beginWork, commitWork, db, runInWork } from "@webhare/whdb";
import { spawnSync } from "node:child_process";
import { YAML } from "@webhare/deps";

async function testLowLevel() {
  test.eq({
    userprefix: "<overrideuser>.", module: "system", sep: ":", subnode: "node.subnode.", subkey: "subkey",
    storenode: "<overrideuser>.system.node.subnode.",
    storename: "<overrideuser>.system.node.subnode.subkey",
  }, splitRegistryKey("<overrideuser>.system:node.subnode.subkey"));
  test.eq({
    userprefix: "<overrideuser>.", module: "tollium", sep: ".", subnode: "savestate.", subkey: "150995d2891cb9d2982c8a82b5756ff6",
    storenode: "<overrideuser>.tollium.savestate.",
    storename: "<overrideuser>.tollium.savestate.150995d2891cb9d2982c8a82b5756ff6"
  }, splitRegistryKey("<overrideuser>.tollium.savestate.150995d2891cb9d2982c8a82b5756ff6"));
  test.eq({
    userprefix: "", module: "webhare_testsuite_base_node", sep: ".", subnode: "", subkey: "stupidvalue",
    storenode: "webhare_testsuite_base_node.",
    storename: "webhare_testsuite_base_node.stupidvalue"
  }, splitRegistryKey("webhare_testsuite_base_node.stupidvalue"));

  test.throws(/Invalid registry key name/, () => splitRegistryKey("system.servicemanager.runonce.consilio:migrate_indices_v3"));
  test.eq({
    userprefix: "", module: "system", sep: ".", subnode: "servicemanager.runonce.", subkey: "consilio:migrate_indices_v3",
    storenode: "system.servicemanager.runonce.",
    storename: "system.servicemanager.runonce.consilio:migrate_indices_v3"
  }, splitRegistryKey("system.servicemanager.runonce.consilio:migrate_indices_v3", { acceptInvalidKeyNames: true }));

  "webhare_testsuite:tests.taskthrownow" satisfies RegistryKeyOfType<boolean>;
  "webhare_testsuite:tests.secondhareinterface" satisfies RegistryKeyOfType<string>;
  //@ts-expect-error -- taskthrownow is of type boolean
  "webhare_testsuite:tests.taskthrownow" satisfies RegistryKeyOfType<string>;

  "webhare_testsuite:tests.lastaftercompile" satisfies RegistryKeyOfType<Temporal.Instant | null>;

  //Ensure readRegistryKey trusts RegistryKeyOfType<boolean>
  const booleanKey: RegistryKeyOfType<boolean> = "webhare_testsuite:tests.taskthrownow";
  const x: boolean = await readRegistryKey(booleanKey);
  void (x);
}

async function doKeyTests(basename: string, { acceptInvalidKeyNames = false } = {}) {
  const foruser = basename.startsWith("<");
  //Read&Write have different responses to non existing keys whether is system or user registry, as one requires values to exist and the other requires fallback values to be provided
  await test.throws(foruser ? /Reading a user registry requires/ : /No such registry key/, () => readRegistryKey<number>(basename + "webhare_testsuite_base_node.stupidvalue", undefined, { acceptInvalidKeyNames }));
  test.eq(43, await readRegistryKey(basename + "webhare_testsuite_base_node.stupidvalue", 43, { acceptInvalidKeyNames }));
  await test.throws(foruser ? /Writing a user registry requires/ : /No such registry key/, () => writeRegistryKey(basename + "webhare_testsuite_base_node.stupidvalue", 43, { acceptInvalidKeyNames }));
  await writeRegistryKey(basename + "webhare_testsuite_base_node.stupidvalue", 44, { createIfNeeded: true, acceptInvalidKeyNames });
  test.eq(44, await readRegistryKey(basename + "webhare_testsuite_base_node.stupidvalue", 43, { acceptInvalidKeyNames }));
  await writeRegistryKey(basename + "webhare_testsuite_base_node.stupidvalue", 45, { createIfNeeded: true, acceptInvalidKeyNames });
  test.eq(45, await readRegistryKey(basename + "webhare_testsuite_base_node.stupidvalue", 43, { acceptInvalidKeyNames }));
  await writeRegistryKey(basename + "webhare_testsuite_base_node.stupidvalue", 46, { initialCreate: true, acceptInvalidKeyNames });
  test.eq(45, await readRegistryKey(basename + "webhare_testsuite_base_node.stupidvalue", 43, { acceptInvalidKeyNames }));
  await commitWork();
  await beginWork();

  await writeRegistryKey(basename + "webhare_testsuite_base_node.blobvalue", WebHareBlob.from("Hello, World!"), { createIfNeeded: true, acceptInvalidKeyNames });
  test.eq("Hello, World!", await (await readRegistryKey<WebHareBlob>(basename + "webhare_testsuite_base_node.blobvalue", WebHareBlob.from(""), { acceptInvalidKeyNames })).text());

  await writeRegistryKey(basename + "webhare_testsuite_base_node.blobvalue", WebHareBlob.from("Hello, World!".repeat(1000)), { createIfNeeded: true, acceptInvalidKeyNames });
  test.eq("Hello, World!".repeat(1000), await (await readRegistryKey<WebHareBlob>(basename + "webhare_testsuite_base_node.blobvalue", WebHareBlob.from(""), { acceptInvalidKeyNames })).text());

  {
    const node = (await readRegistryNode(basename + "webhare_testsuite_base_node", { acceptInvalidKeyNames })).toSorted((lhs, rhs) => lhs.fullname.localeCompare(rhs.fullname));
    test.eqPartial([
      { fullname: basename + "webhare_testsuite_base_node.blobvalue", subkey: "blobvalue" },
      { fullname: basename + "webhare_testsuite_base_node.stupidvalue", subkey: "stupidvalue", data: 45 }
    ], node);
    test.eq("Hello, World!".repeat(1000), await (node[0].data as WebHareBlob).text());
  }

  await deleteRegistryKey(basename + "webhare_testsuite_base_node.stupidvalue", { acceptInvalidKeyNames });
  await test.throws(foruser ? /Reading a user registry requires/ : /No such registry key/, () => readRegistryKey<number>(basename + "webhare_testsuite_base_node.stupidvalue", undefined, { acceptInvalidKeyNames }));
  test.eqPartial([
    {
      fullname: basename + "webhare_testsuite_base_node.blobvalue", subkey: "blobvalue"
    }
  ], (await readRegistryNode(basename + "webhare_testsuite_base_node", { acceptInvalidKeyNames })).toSorted((lhs, rhs) => lhs.fullname.localeCompare(rhs.fullname)));
  test.eq(47, await readRegistryKey(basename + "webhare_testsuite_base_node.stupidvalue", 47, { acceptInvalidKeyNames }));

  await writeRegistryKey(basename + "webhare_testsuite_base_node.stupidvalue", 48, { initialCreate: true, acceptInvalidKeyNames });
  await deleteRegistryNode(basename + "webhare_testsuite_base_node", { acceptInvalidKeyNames });
  test.eq([], await readRegistryNode(basename + "webhare_testsuite_base_node", { acceptInvalidKeyNames }));
}

async function testRegistry() {
  await readRegistryKey("system:backend.development.manualdebugmgr");

  const now = Temporal.Now.instant().round({ smallestUnit: "milliseconds" });
  await runInWork(() => writeRegistryKey("webhare_testsuite:tests.lastaftercompile", now));
  test.eq(now, await readRegistryKey("webhare_testsuite:tests.lastaftercompile"));

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

  const signal = await signalOnRegistryKeyChange("webhare_testsuite.webhare_testsuite_base_node.stupidvalue");
  const signal2 = await signalOnRegistryKeyChange(["webhare_testsuite.webhare_testsuite_base_node.stupidvalue"]);
  await commitWork();
  await test.wait(() => signal.aborted && signal2.aborted);

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

  await beginWork();
  test.eq(null, await readRegistryKey("webhare_testsuite:registrytests.temporal_instant"));
  await writeRegistryKey("webhare_testsuite:registrytests.temporal_instant", Temporal.Instant.from("2024-01-01T00:00:00Z"));
  test.eq(Temporal.Instant.from("2024-01-01T00:00:00Z"), await readRegistryKey("webhare_testsuite:registrytests.temporal_instant"));
  test.eq(new Date("2024-01-01T00:00:00Z"), await loadlib("mod::system/lib/configure.whlib").readRegistryKey("webhare_testsuite:registrytests.temporal_instant"));
  await writeRegistryKey("webhare_testsuite:registrytests.temporal_instant", null);
  test.eq(null, await readRegistryKey("webhare_testsuite:registrytests.temporal_instant"));
  test.eq(defaultDateTime, await loadlib("mod::system/lib/configure.whlib").readRegistryKey("webhare_testsuite:registrytests.temporal_instant"));
  await commitWork();

}

function runRegistryCommand(args: string[], input = "") {
  const result = spawnSync("wh", ["registry", ...args], { encoding: "utf-8", input });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// Tests the 'wh registry' list, export and import subcommands. Uses its own (undeclared) keys below webhare_testsuite_cli
async function testCLI() {
  const node = "webhare_testsuite:webhare_testsuite_cli";
  const recordValue = {
    suppliers: getTypedArray(HareScriptType.RecordArray, []),
    price: Money.fromNumber(1.5),
    big: 2n ** 40n,
    ratio: 2.5,
    when: new Date("2024-01-01T00:00:00Z"),
  };

  await runInWork(async () => {
    await db<PlatformDB>().deleteFrom("system.flatregistry").where("name", "like", "%webhare_testsuite_cli%").execute();
    await writeRegistryKey(`${node}.string`, "cli test", { createIfNeeded: true });
    await writeRegistryKey(`${node}.record`, recordValue, { createIfNeeded: true });
    await writeRegistryKey(`${node}.float`, 2.5, { createIfNeeded: true });
    await writeRegistryKey(`${node}.instant`, Temporal.Instant.from("2024-01-01T00:00:00Z"), { createIfNeeded: true });
    await writeRegistryKey(`${node}.withblob`, { logo: WebHareBlob.from("hello") }, { createIfNeeded: true });
  });

  ////////////////////////////////////////////////////////////////
  // STORY: list accepts multiple masks and shows types and descriptions, but no values
  const list = runRegistryCommand(["list", "--json", `${node}.?tring`, `${node}.record`, "system:webserver.security.cookiesecret", "publisher:publication.maxpublishtime"]);
  test.eq([
    { name: "publisher:publication.maxpublishtime", type: "integer", description: "Maximum publication time (seconds)" },
    { name: "system:webserver.security.cookiesecret", type: "string", description: "Secret key used to encrypt/sign cookies" },
    { name: `${node}.record`, type: "record", description: "" },
    { name: `${node}.string`, type: "string", description: "" },
  ], JSON.parse(list.stdout), "publisher:publication.* is declared by the system module, its description must be found without listing a system: key");

  test.eqPartial({ status: 1, stderr: /No registry keys match the mask 'webhare_testsuite:nosuchnode\.\*'/ }, runRegistryCommand(["list", `${node}.*`, "webhare_testsuite:nosuchnode.*"]));

  ////////////////////////////////////////////////////////////////
  // STORY: export outputs the values as YAML, or JSON on request, and skips values containing a blob
  const exported = runRegistryCommand(["export", `${node}.*`]);
  test.eq(0, exported.status);
  test.eq(/Skipped 1 key.*blob.*'webhare_testsuite:webhare_testsuite_cli.withblob'/, exported.stderr);
  const exportedKeys = YAML.parse(exported.stdout);
  test.eq("cli test", exportedKeys[`${node}.string`]);
  test.eq(false, `${node}.withblob` in exportedKeys);

  const exportedJSON = runRegistryCommand(["export", "--json", `${node}.string`]);
  test.eq({ [`${node}.string`]: "cli test" }, JSON.parse(exportedJSON.stdout));

  ////////////////////////////////////////////////////////////////
  // STORY: importing unchanged values doesn't rewrite them, so nothing loses its type
  const rawBefore = await db<PlatformDB>().selectFrom("system.flatregistry").select(["name", "data"]).where("name", "like", "%webhare_testsuite_cli%").orderBy("name").execute();
  const reimport = runRegistryCommand(["import", "--json", "-"], exported.stdout);
  test.eq({ imported: [], unchanged: [`${node}.float`, `${node}.instant`, `${node}.record`, `${node}.string`], skipped: [] }, JSON.parse(reimport.stdout));
  test.eq(rawBefore, await db<PlatformDB>().selectFrom("system.flatregistry").select(["name", "data"]).where("name", "like", "%webhare_testsuite_cli%").orderBy("name").execute());

  ////////////////////////////////////////////////////////////////
  // STORY: import restores changed values, including their types
  await runInWork(async () => {
    await writeRegistryKey(`${node}.string`, "overwritten");
    await writeRegistryKey(`${node}.record`, { suppliers: [{ name: "x" }], price: Money.fromNumber(3), big: 1n, ratio: 7.5, when: new Date("2025-01-01T00:00:00Z") });
    await writeRegistryKey(`${node}.instant`, null);
  });

  test.eqPartial({ status: 0, stderr: "" }, runRegistryCommand(["import", "-"], exported.stdout));
  test.eq("cli test", await readRegistryKey<string>(`${node}.string`));
  test.eq(Temporal.Instant.from("2024-01-01T00:00:00Z"), await readRegistryKey<Temporal.Instant>(`${node}.instant`));
  test.eq(recordValue, await readRegistryKey<typeof recordValue>(`${node}.record`));
  test.eq(/"suppliers":ra\[\]/, (await db<PlatformDB>().selectFrom("system.flatregistry").select("data").where("name", "=", "webhare_testsuite.webhare_testsuite_cli.record").executeTakeFirstOrThrow()).data, "The empty array must keep its RECORD ARRAY type");

  ////////////////////////////////////////////////////////////////
  // STORY: import refuses changes it can't store faithfully
  test.eqPartial({ status: 1, stderr: /Cannot import 'webhare_testsuite:webhare_testsuite_cli.float'.*float/ }, runRegistryCommand(["import", "-"], YAML.stringify({ [`${node}.float`]: 3 })));
  test.eqPartial({ status: 0 }, runRegistryCommand(["import", "-"], YAML.stringify({ [`${node}.float`]: 3.5 })));
  test.eq(3.5, await readRegistryKey<number>(`${node}.float`));
  test.eqPartial({ status: 1, stderr: /Cannot import 'webhare_testsuite:webhare_testsuite_cli.record'.*float/ }, runRegistryCommand(["import", "-"], YAML.stringify({ [`${node}.record`]: { ...exportedKeys[`${node}.record`], ratio: 3 } })));
  test.eq(recordValue, await readRegistryKey<typeof recordValue>(`${node}.record`));

  test.eqPartial({ status: 1, stderr: /Cannot import 'webhare_testsuite:webhare_testsuite_cli.withblob'.*blob/ }, runRegistryCommand(["import", "-"], YAML.stringify({ [`${node}.withblob`]: { logo: "x" } })));
  test.eq("hello", await (await readRegistryKey<{ logo: WebHareBlob }>(`${node}.withblob`)).logo.text());

  test.eqPartial({ status: 1, stderr: /^Error: Cannot read 'nosuchfile.yml': ENOENT/ }, runRegistryCommand(["import", "nosuchfile.yml"]));
  test.eqPartial({ status: 1, stderr: /Invalid registry key name 'nocolon' in '-', expected 'module:node.key'/ }, runRegistryCommand(["import", "-"], YAML.stringify({ nocolon: 1 })));

  test.eqPartial({ status: 1, stderr: /Cannot import 'webhare_testsuite:webhare_testsuite_cli.string'.*got Integer but expected String/ }, runRegistryCommand(["import", "-"], YAML.stringify({ [`${node}.string`]: 42 })));

  ////////////////////////////////////////////////////////////////
  // STORY: importing unknown keys fails without changing anything, unless --skip-unknown is set
  const withUnknown = YAML.stringify({ [`${node}.string`]: "second import", [`${node}.nosuchkey`]: 42 });
  test.eqPartial({ status: 1, stderr: /do not exist.*'webhare_testsuite:webhare_testsuite_cli.nosuchkey'/ }, runRegistryCommand(["import", "-"], withUnknown));
  test.eq("cli test", await readRegistryKey<string>(`${node}.string`));

  const skipUnknown = runRegistryCommand(["import", "--json", "--skip-unknown", "-"], withUnknown);
  test.eq({ imported: [`${node}.string`], unchanged: [], skipped: [`${node}.nosuchkey`] }, JSON.parse(skipUnknown.stdout));
  test.eq("second import", await readRegistryKey<string>(`${node}.string`));
  await test.throws(/No such registry key/, () => readRegistryKey<number>(`${node}.nosuchkey`));
}

test.runTests([
  testLowLevel,
  testRegistry,
  testModuleDefs,
  testCLI
]);

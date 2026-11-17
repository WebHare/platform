import { wrd, type WRDSchemaLike } from "@webhare/wrd";
import * as test from "@mod-webhare_testsuite/js/wts-backend";
import { createWRDTestSchema, testSchemaTag, type CustomExtensions } from "@mod-webhare_testsuite/js/wrd/testhelpers";
import type { Combine, WRDInsertable } from "@webhare/wrd/src/types";
import { buildRTD, ResourceDescriptor } from "@webhare/services";
import { beginWork, commitWork } from "@webhare/whdb";
import { spawnSync } from "node:child_process";
import type { RTDExport } from "@webhare/services/src/richdocument";
import { omit } from "@webhare/std";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { YAML } from "@webhare/deps";
import { storeTempFile } from "@webhare/system-tools";

async function testWRDSettingsCli() {
  await createWRDTestSchema();
  const testSchema = wrd("wrd:testschema");
  const settingsId = await testSchema.search("wrdSettings", "wrdTag", "WRD_SETTINGS");
  test.assert(settingsId);

  const getResult = spawnSync("wh", ["wrd", "get-setting", "--json", testSchemaTag], { shell: false, encoding: "utf-8", stdio: ['inherit', 'pipe', 'inherit'] });
  test.eq(0, getResult.status);
  const settings = JSON.parse(getResult.stdout);
  test.eq(settingsId, settings.wrdId);
  test.eq("WRD_SETTINGS", settings.wrdTag);

  const tempDir = mkdtempSync(join(tmpdir(), "wrd-settings-cli-"));
  try {
    const source = join(tempDir, "settings.yml");
    writeFileSync(source, YAML.stringify({ defaultSenderName: "CLI test sender" }));
    const originalSenderName = await testSchema.getFields("wrdSettings", settingsId, "defaultSenderName");

    const dryUpdateResult = spawnSync("wh", ["wrd", "update-setting", "--json", "--dry-run", testSchemaTag, source], { shell: false, encoding: "utf-8", stdio: ['inherit', 'pipe', 'inherit'] });
    test.eq(0, dryUpdateResult.status);
    test.eq({ wrdId: settingsId }, JSON.parse(dryUpdateResult.stdout));
    test.eq(originalSenderName, await testSchema.getFields("wrdSettings", settingsId, "defaultSenderName"));

    const updateResult = spawnSync("wh", ["wrd", "update-setting", "--json", testSchemaTag, source], { shell: false, encoding: "utf-8", stdio: ['inherit', 'pipe', 'inherit'] });
    test.eq(0, updateResult.status);
    test.eq({ wrdId: settingsId }, JSON.parse(updateResult.stdout));
    test.eq("CLI test sender", await testSchema.getFields("wrdSettings", settingsId, "defaultSenderName"));

    const yamlResult = spawnSync("wh", ["wrd", "get-setting", testSchemaTag], { shell: false, encoding: "utf-8", stdio: ['inherit', 'pipe', 'inherit'] });
    test.eq(0, yamlResult.status);
    test.eqPartial({ wrdId: settingsId, wrdTag: "WRD_SETTINGS", defaultSenderName: "CLI test sender" }, YAML.parse(yamlResult.stdout));

    const fieldResult = spawnSync("wh", ["wrd", "get-setting", "--json", testSchemaTag, "defaultSenderName"], { shell: false, encoding: "utf-8", stdio: ['inherit', 'pipe', 'inherit'] });
    test.eq(0, fieldResult.status);
    test.eq("CLI test sender", JSON.parse(fieldResult.stdout));

    const yamlFieldResult = spawnSync("wh", ["wrd", "get-setting", testSchemaTag, "wrdId"], { shell: false, encoding: "utf-8", stdio: ['inherit', 'pipe', 'inherit'] });
    test.eq(0, yamlFieldResult.status);
    test.eq(settingsId, YAML.parse(yamlFieldResult.stdout));

    const invalidFieldResult = spawnSync("wh", ["wrd", "get-setting", testSchemaTag, "nonexistentField"], { shell: false, encoding: "utf-8", stdio: ['inherit', 'pipe', 'pipe'] });
    test.eq(1, invalidFieldResult.status);
    test.eq(/nonexistentField/i, invalidFieldResult.stderr);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testWRDCli() { //  tests
  type TestSchemaType = Combine<[WRDSchemaLike["wrd:testschema"], CustomExtensions]>;
  const wrdschema = wrd<TestSchemaType>(testSchemaTag);
  await createWRDTestSchema();

  await beginWork();
  const testunit = await wrdschema.insert("whuserUnit", { wrdTitle: "Root unit", wrdTag: "TESTFW_ROOT_UNIT" });
  const fish = await ResourceDescriptor.fromResource("mod::system/web/tests/goudvis.png", { getHash: true, getImageMetadata: true });
  const newPerson = await wrdschema.insert("wrdPerson", {
    wrdFirstName: "Alice",
    wrdLastName: "Smith",
    wrdContactEmail: "alice.smith@beta.webhare.net",
    richie: await buildRTD([{ p: ["Dit is een test met image: ", { image: fish }] }]),
    whuserUnit: testunit,
    wrdauthAccountStatus: { status: "active" },
  });

  await commitWork();

  const clonableAttributes = (await wrdschema.getType("wrdPerson").listAttributes()).
    filter(attr => !["wrdId", "wrdGuid", "wrdType", "wrdTitle", "wrdFullName", "wrdContactEmail"].includes(attr.tag)).
    map(_ => _.tag) as Array<keyof WRDInsertable<TestSchemaType["wrdPerson"]>>;
  const original = await wrdschema.getFields("wrdPerson", newPerson, clonableAttributes);

  const fieldResult = spawnSync("wh", ["wrd", "get-entity", "--json", String(newPerson), "wrdFirstName"], { shell: false, encoding: "utf-8", stdio: ['inherit', 'pipe', 'inherit'] });
  test.eq(0, fieldResult.status);
  test.eq("Alice", JSON.parse(fieldResult.stdout));

  const yamlFieldResult = spawnSync("wh", ["wrd", "get-entity", String(newPerson), "wrdId"], { shell: false, encoding: "utf-8", stdio: ['inherit', 'pipe', 'inherit'] });
  test.eq(0, yamlFieldResult.status);
  test.eq(newPerson, YAML.parse(yamlFieldResult.stdout));

  for (const resourceMode of ["fetch", "base64"] as const) {
    const options = resourceMode === "fetch" ? [] : ["--resources", "base64"];

    const exportResult = spawnSync("wh", ["wrd", "get-entity", "--json", ...options, String(newPerson)], { shell: false, encoding: "utf-8", stdio: ['inherit', 'pipe', 'inherit'] });
    test.eq(0, exportResult.status, "wrd export command should succeed");
    const exportData = JSON.parse(exportResult.stdout);
    const richieFirstParagraph = (exportData.richie as RTDExport)[0];
    test.assert("tag" in richieFirstParagraph && richieFirstParagraph.tag === "p");
    const imageNode = richieFirstParagraph.items[1];
    test.assert("image" in imageNode);

    if (resourceMode === "base64") {
      test.assert("base64" in imageNode.image.file);
    } else {
      test.assert(!("base64" in imageNode.image.file));
    }

    const insertPerson = omit(exportData, ["wrdId", "wrdGuid"]);
    insertPerson.wrdContactEmail = `import-${resourceMode}@beta.webhare.net`;
    const dryInsertResult = spawnSync("wh", ["wrd", "create-entity", "--json", "--dry-run", testSchemaTag, "wrdPerson", "-"], { shell: false, encoding: "utf-8", input: JSON.stringify(insertPerson), stdio: ['pipe', 'pipe', 'inherit'] });
    test.eq(0, dryInsertResult.status);
    const dryInsertOutput = JSON.parse(dryInsertResult.stdout);
    test.eq(null, await wrdschema.search("wrdPerson", "wrdId", dryInsertOutput.wrdId));
    test.eq(null, await wrdschema.search("wrdPerson", "wrdContactEmail", insertPerson.wrdContactEmail));

    const insertResult = spawnSync("wh", ["wrd", "create-entity", "--json", testSchemaTag, "wrdPerson", "-"], { shell: false, encoding: "utf-8", input: JSON.stringify(insertPerson), stdio: ['pipe', 'pipe', 'inherit'] });
    test.eq(0, insertResult.status, "wrd insert command should succeed");
    const insertOutput = JSON.parse(insertResult.stdout);

    const inserted = await wrdschema.getFields("wrdPerson", insertOutput.wrdId, clonableAttributes);
    test.eq(original, inserted);

    exportData.wrdFirstName = "Updated";
    exportData.wrdContactEmail = insertPerson.wrdContactEmail;
    exportData.wrdGuid = insertOutput.wrdGuid;
    const dryUpdateResult = spawnSync("wh", ["wrd", "update-entity", "--json", "--dry-run", String(insertOutput.wrdId), "-"], { shell: false, encoding: "utf-8", input: JSON.stringify(exportData), stdio: ['pipe', 'pipe', 'inherit'] });
    test.eq(0, dryUpdateResult.status);
    test.eq({ wrdId: insertOutput.wrdId }, JSON.parse(dryUpdateResult.stdout));
    test.eq(original, await wrdschema.getFields("wrdPerson", insertOutput.wrdId, clonableAttributes));

    const updateResult = spawnSync("wh", ["wrd", "update-entity", "--json", String(insertOutput.wrdId), "-"], { shell: false, encoding: "utf-8", input: JSON.stringify(exportData), stdio: ['pipe', 'pipe', 'inherit'] });
    test.eq(0, updateResult.status);
    test.eq({ wrdId: insertOutput.wrdId }, JSON.parse(updateResult.stdout));
    const updated = await wrdschema.getFields("wrdPerson", insertOutput.wrdId, [...clonableAttributes, "wrdGuid"]);
    test.eq({ ...original, wrdFirstName: "Updated", wrdGuid: insertOutput.wrdGuid }, updated);

    const searchResult = spawnSync("wh", ["wrd", "search", testSchemaTag, "wrdPerson", "wrdContactEmail", insertPerson.wrdContactEmail], { shell: false, encoding: "utf-8", stdio: ['inherit', 'pipe', 'inherit'] });
    test.eq(0, searchResult.status);
    test.eq(String(insertOutput.wrdId) + "\n", searchResult.stdout);
  }

  const missingResult = spawnSync("wh", ["wrd", "search", "--json", testSchemaTag, "wrdPerson", "wrdContactEmail", "missing@beta.webhare.net"], { shell: false, encoding: "utf-8", stdio: ['inherit', 'pipe', 'inherit'] });
  test.eq(0, missingResult.status);
  test.eq("null\n", missingResult.stdout);
}

async function testWRDCloseDeleteCli() {
  type TestSchemaType = Combine<[WRDSchemaLike["wrd:testschema"], CustomExtensions]>;
  const wrdschema = wrd<TestSchemaType>(testSchemaTag);
  await createWRDTestSchema();

  await beginWork();
  const testunit = await wrdschema.insert("whuserUnit", { wrdTitle: "Root unit", wrdTag: "TESTFW_ROOT_UNIT" });
  const ids = [];
  for (const name of ["Close1", "Close2", "Delete1", "Delete2"])
    ids.push(await wrdschema.insert("wrdPerson", { wrdFirstName: name, wrdLastName: "Test", wrdContactEmail: `${name.toLowerCase()}@beta.webhare.net`, whuserUnit: testunit, wrdauthAccountStatus: { status: "active" } }));
  await commitWork();
  const [close1, close2, delete1, delete2] = ids;

  //Missing entity should abort without changing anything
  const missingResult = spawnSync("wh", ["wrd", "close-entity", String(close1), "999999999"], { shell: false, encoding: "utf-8", stdio: ['inherit', 'pipe', 'pipe'] });
  test.eq(1, missingResult.status);
  test.eq(/999999999/, missingResult.stderr);
  test.eq(close1, await wrdschema.search("wrdPerson", "wrdId", close1));

  const closeResult = spawnSync("wh", ["wrd", "close-entity", "--json", String(close1), String(close2)], { shell: false, encoding: "utf-8", stdio: ['inherit', 'pipe', 'inherit'] });
  test.eq(0, closeResult.status);
  test.eq({ wrdIds: [close1, close2] }, JSON.parse(closeResult.stdout));
  test.eq(null, await wrdschema.search("wrdPerson", "wrdId", close1));
  test.eq(null, await wrdschema.search("wrdPerson", "wrdId", close2));
  test.eq(close1, await wrdschema.search("wrdPerson", "wrdId", close1, { historyMode: "all" }));

  const deleteResult = spawnSync("wh", ["wrd", "delete-entity", String(delete1), String(delete2), String(close1)], { shell: false, encoding: "utf-8", stdio: ['inherit', 'pipe', 'inherit'] });
  test.eq(0, deleteResult.status);
  test.eq(`Deleted #${delete1}, #${delete2}, #${close1}\n`, deleteResult.stdout);
  for (const id of [delete1, delete2, close1])
    test.eq(null, await wrdschema.search("wrdPerson", "wrdId", id, { historyMode: "unfiltered" }));
  test.eq(close2, await wrdschema.search("wrdPerson", "wrdId", close2, { historyMode: "all" }));
}

async function testWRDEditEntityCli() {
  type TestSchemaType = Combine<[WRDSchemaLike["wrd:testschema"], CustomExtensions]>;
  const wrdschema = wrd<TestSchemaType>(testSchemaTag);
  await createWRDTestSchema();

  await beginWork();
  const testunit = await wrdschema.insert("whuserUnit", { wrdTitle: "Root unit", wrdTag: "TESTFW_ROOT_UNIT" });
  const personId = await wrdschema.insert("wrdPerson", { wrdFirstName: "Edit", wrdLastName: "Test", wrdContactEmail: "edit@beta.webhare.net", whuserUnit: testunit, wrdauthAccountStatus: { status: "active" } });
  await commitWork();

  //Our 'editor' saves the path and contents of the file it got, and replaces it with the contents of 'newSource' (if not empty)
  await using editPath = await storeTempFile("editpath.txt", "");
  await using originalSource = await storeTempFile("original.yml", "");
  await using newSource = await storeTempFile("newsource.yml", "");
  await using editorScript = await storeTempFile("editor.sh", `#!/bin/sh\necho "$1" > "${editPath.path}"\ncp "$1" "${originalSource.path}"\n[ -s "${newSource.path}" ] && cp "${newSource.path}" "$1"\nexit 0\n`, { mode: "700" });

  const runEdit = (env: Record<string, string | undefined>) => spawnSync("wh", ["wrd", "edit-entity", String(personId)], {
    shell: false, encoding: "utf-8", stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, VISUAL: undefined, EDITOR: undefined, ...env }
  });

  //Unmodified file
  const unmodifiedResult = runEdit({ EDITOR: editorScript.path });
  test.eq(0, unmodifiedResult.status);
  test.eq(`Entity #${personId} not modified\n`, unmodifiedResult.stdout);
  const original = readFileSync(originalSource.path, "utf-8");
  test.eq(/^wrdFirstName: Edit$/m, original);
  test.eq(/^# wrdModified: /m, original);
  test.assert(!existsSync(readFileSync(editPath.path, "utf-8").trim()), "temporary file should be removed");

  //VISUAL takes precedence over EDITOR
  writeFileSync(newSource.path, original.replace(/^wrdFirstName: Edit$/m, "wrdFirstName: Edited"));
  const editResult = runEdit({ VISUAL: editorScript.path, EDITOR: "false" });
  test.eq(0, editResult.status, editResult.stderr);
  test.eq(`Updated entity #${personId}\n`, editResult.stdout);
  test.eq("Edited", await wrdschema.getFields("wrdPerson", personId, "wrdFirstName"));

  //Invalid source fails without updating (and doesn't offer to retry as stdin isn't a terminal)
  writeFileSync(newSource.path, "- not an object\n");
  const invalidResult = runEdit({ EDITOR: editorScript.path });
  test.eq(1, invalidResult.status);
  test.eq(/must be a YAML object/, invalidResult.stderr);
  test.eq("Edited", await wrdschema.getFields("wrdPerson", personId, "wrdFirstName"));

  //When wh is terminated while the editor runs, the editor should be stopped and the temporary file still removed
  await using killerScript = await storeTempFile("killer.sh", `#!/bin/sh\necho "$1" > "${editPath.path}"\nP=$PPID\nwhile [ "$P" -gt 1 ] && ! ps -o command= -p $P | grep -q node; do P=$(ps -o ppid= -p $P | tr -d ' '); done\nkill -TERM $P\nexec sleep 30\n`, { mode: "700" });
  const killedResult = runEdit({ EDITOR: killerScript.path });
  test.eq(1, killedResult.status, killedResult.stderr);
  test.eq(/exited with/, killedResult.stderr);
  test.assert(!existsSync(readFileSync(editPath.path, "utf-8").trim()), "temporary file should be removed after SIGTERM");

  const failingEditorResult = runEdit({ EDITOR: "false" });
  test.eq(1, failingEditorResult.status);
  test.eq(/exited with code 1/, failingEditorResult.stderr);
}

test.runTests([
  //basic exports to get typings right
  testWRDSettingsCli,
  testWRDCli,
  testWRDCloseDeleteCli,
  testWRDEditEntityCli,
]);

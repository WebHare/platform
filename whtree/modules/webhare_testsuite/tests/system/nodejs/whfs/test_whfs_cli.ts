import * as test from "@mod-webhare_testsuite/js/wts-backend";
import { buildInstance, buildRTD, ResourceDescriptor } from "@webhare/services";
import type { RTDExport } from "@webhare/services/src/richdocument";
import { beginWork, commitWork } from "@webhare/whdb";
import { whfsType } from "@webhare/whfs";
import { spawnSync } from "node:child_process";

function getTypeUsageCounts() {
  const listResult = spawnSync("wh", ["whfs", "list-types", "--json", "--count", "platform:filetypes.richdocument", "webhare_testsuite:global.generic_test_type"], { shell: false, encoding: "utf-8", stdio: ['inherit', 'pipe', 'inherit'] });
  test.eq(0, listResult.status, "list-types command should succeed");
  const types = JSON.parse(listResult.stdout) as Array<{ type: string; count: { objects: number; instances: number; embedded: number } }>;
  return {
    rtd: types.find(type => type.type === "platform:filetypes.richdocument")!.count,
    widget: types.find(type => type.type === "webhare_testsuite:global.generic_test_type")!.count
  };
}

async function testWHFSCli() {
  const baseline = getTypeUsageCounts();

  //setup test data
  await beginWork();
  const tmpfolder = await test.getTestSiteJSTemp();
  const newFile = await tmpfolder.createFile("new-file", { type: "platform:filetypes.richdocument", title: "Export test", data: null });
  const newFile2 = await tmpfolder.createFile("new-file-2", { type: "platform:filetypes.richdocument", title: "Export test", data: null });
  const fish = await ResourceDescriptor.fromResource("mod::system/web/tests/goudvis.png", { getHash: true, getImageMetadata: true });
  await whfsType("platform:filetypes.richdocument").set(newFile.id, {
    data: await buildRTD([
      { p: ["Dit is een test met image: ", { image: fish }] },
      { widget: await buildInstance({ whfsType: "webhare_testsuite:global.generic_test_type", data: { str: "embedded widget" } }) }
    ])
  });
  await commitWork();

  for (const resourceMode of ["fetch", "base64"] as const) {
    const options = resourceMode === "fetch" ? [] : ["--resources", "base64"];

    const exportResult = spawnSync("wh", ["whfs", "get-object", "--json", ...options, newFile.id.toString()], { shell: false, encoding: "utf-8", stdio: ['inherit', 'pipe', 'inherit'] });
    test.eq(0, exportResult.status, "export command should succeed");

    const exportData = JSON.parse(exportResult.stdout);
    const rtdInstance = exportData.instances.find((inst: any) => inst.whfsType === "platform:filetypes.richdocument");
    test.assert(rtdInstance);

    const richieFirstParagraph = (rtdInstance.data.data as RTDExport)[0];
    test.assert("tag" in richieFirstParagraph && richieFirstParagraph.tag === "p");
    const imageNode = richieFirstParagraph.items[1];
    test.assert("image" in imageNode);

    if (resourceMode === "base64") {
      test.assert("base64" in imageNode.image.file);
    } else {
      test.assert(!("base64" in imageNode.image.file));
    }

    // test being able to update it
    richieFirstParagraph.items[0] = { text: `Modified text, mode = ${resourceMode}: ` };
    const importResult = spawnSync("wh", ["whfs", "update-object", "--json", newFile2.id.toString(), "-"], { shell: false, encoding: "utf-8", stdio: ['pipe', 'pipe', 'inherit'], input: JSON.stringify(exportData) });
    test.eq(0, importResult.status, "import command should succeed");
    test.eq(newFile2.id, JSON.parse(importResult.stdout).id, "imported object should have correct id");

    // compare
    const rtdData2 = (await whfsType("platform:filetypes.richdocument").get(newFile2.id)).data as any;
    test.eq(rtdData2.blocks[0].items[0], richieFirstParagraph.items[0]);
  }

  const counts = getTypeUsageCounts();
  test.eq(baseline.rtd.objects + 2, counts.rtd.objects, "should count our two new files");
  test.eq(baseline.rtd.instances + 2, counts.rtd.instances, "should count the instances of our two new files");
  test.eq(baseline.widget.embedded + 2, counts.widget.embedded, "should count the widget embedded in both files");
}

function runFindInstances(args: string[]) {
  const result = spawnSync("wh", ["whfs", "find-instances", ...args], { shell: false, encoding: "utf-8", stdio: ['inherit', 'pipe', 'pipe'] });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

async function testFindInstances() {
  await beginWork();
  const tmpfolder = await (await test.getTestSiteJSTemp()).createFolder("find-instances"); //own folder, testWHFSCli leaves widgets in the temp folder
  const formWithMax = await tmpfolder.createFile("form-with-max", { type: "platform:filetypes.form" });
  await whfsType("platform:filetypes.form").set(formWithMax.id, { maxsignups: 5 });
  const formNoMax = await tmpfolder.createFile("form-no-max", { type: "platform:filetypes.form" });
  const emptyFolder = await tmpfolder.createFolder("empty-folder");
  const widgetHolder = await tmpfolder.createFile("widget-holder", { type: "platform:filetypes.richdocument" });
  await whfsType("platform:filetypes.richdocument").set(widgetHolder.id, {
    data: await buildRTD([
      { p: "Widgets:" },
      { widget: { whfsType: "webhare_testsuite:global.generic_test_type", data: { int: 42, str: "first" } } },
      { widget: { whfsType: "webhare_testsuite:global.generic_test_type", data: { int: 7, str: "second" } } }
    ])
  });
  await commitWork();

  const tmpPath = tmpfolder.whfsPath;

  //Find forms with a maxsignups setting
  let result = runFindInstances(["platform:filetypes.form", "--json", "--start-folder", tmpPath, "--where", "$.maxsignups > 0", "--select", "maxsignups"]);
  test.eq(0, result.status, result.stderr);
  test.eqPartial([{ id: formWithMax.id, source: "object", data: { maxsignups: 5 } }], JSON.parse(result.stdout));

  //Without a filter, both forms should be found
  result = runFindInstances(["platform:filetypes.form", "--ids", "--start-folder", tmpPath]);
  test.eq(0, result.status, result.stderr);
  test.eq([formNoMax.id, formWithMax.id].sort(), result.stdout.trim().split("\n").map(Number).sort());

  //Filter on the object info
  result = runFindInstances(["platform:filetypes.form", "--ids", "--start-folder", tmpPath, "--where", "obj.name === 'form-no-max'"]);
  test.eq(0, result.status, result.stderr);
  test.eq(`${formNoMax.id}\n`, result.stdout);

  //Nothing found prints nothing
  result = runFindInstances(["platform:filetypes.form", "--ids", "--start-folder", tmpPath, "--where", "$.maxsignups > 1000"]);
  test.eq(0, result.status, result.stderr);
  test.eq("", result.stdout);

  //--start-folder limits the search, and can be repeated to search in multiple folders
  result = runFindInstances(["platform:filetypes.form", "--ids", "--start-folder", emptyFolder.whfsPath]);
  test.eq(0, result.status, result.stderr);
  test.eq("", result.stdout);

  result = runFindInstances(["platform:filetypes.form", "--ids", "--start-folder", emptyFolder.whfsPath, "--start-folder", tmpPath, "--where", "$.maxsignups > 0"]);
  test.eq(0, result.status, result.stderr);
  test.eq(`${formWithMax.id}\n`, result.stdout);

  result = runFindInstances(["platform:filetypes.form", "--ids", "--start-folder", formWithMax.whfsPath]);
  test.eq(1, result.status);
  test.eq(/is not a folder/, result.stderr);

  //Members accessed in ways we can't predict from the expression text are still loaded
  for (const where of [
    `$["max" + "signups"] > 0`, //computed member name
    `Object.keys($).includes("maxsignups") && $.maxsignups > 0`, //listing all members
    `(({ maxsignups }) => maxsignups > 0)($)`, //destructuring
    `"maxsignups" in $ && $.maxsignups > 0`,
    `(() => { try { return $.maxsignups > 0; } catch { return true; } })()`, //swallowing our 'need more members' exception
  ]) {
    result = runFindInstances(["platform:filetypes.form", "--ids", "--start-folder", tmpPath, "--where", where]);
    test.eq(0, result.status, result.stderr);
    test.eq(`${formWithMax.id}\n`, result.stdout, `--where ${where}`);
  }

  //The instance data is read-only
  result = runFindInstances(["platform:filetypes.form", "--start-folder", tmpPath, "--where", "($.maxsignups = 1)"]);
  test.eq(1, result.status);
  test.eq(/--where expression failed for .*form-/, result.stderr);

  //Embedded instances (widgets)
  result = runFindInstances(["webhare_testsuite:global.generic_test_type", "--json", "--start-folder", tmpPath, "--select", "int", "--select", "str"]);
  test.eq(0, result.status, result.stderr);
  test.eqPartial([
    { id: widgetHolder.id, source: "embedded", embeddedIn: "platform:filetypes.richdocument#data", data: { int: 42, str: "first" } },
    { id: widgetHolder.id, source: "embedded", embeddedIn: "platform:filetypes.richdocument#data", data: { int: 7, str: "second" } }
  ], JSON.parse(result.stdout));

  result = runFindInstances(["webhare_testsuite:global.generic_test_type", "--json", "--start-folder", tmpPath, "--where", "$.int < 10", "--select", "str"]);
  test.eq(0, result.status, result.stderr);
  test.eqPartial([{ id: widgetHolder.id, data: { str: "second" } }], JSON.parse(result.stdout));

  //Counting
  result = runFindInstances(["platform:filetypes.form", "--count", "--json", "--start-folder", tmpPath]);
  test.eq(0, result.status, result.stderr);
  test.eq([{ type: "platform:filetypes.form", objects: 2, instances: 0, embedded: 0, total: 2 }], JSON.parse(result.stdout));

  result = runFindInstances(["platform:filetypes.form", "--count", "--json", "--start-folder", tmpPath, "--where", "$.maxsignups > 0"]);
  test.eq(0, result.status, result.stderr);
  test.eq([{ type: "platform:filetypes.form", objects: 1, instances: 0, embedded: 0, total: 1 }], JSON.parse(result.stdout));

  //Embedded counts every widget, total counts the document holding them once
  result = runFindInstances(["webhare_testsuite:global.generic_test_type", "--count", "--json", "--start-folder", tmpPath]);
  test.eq(0, result.status, result.stderr);
  test.eq([{ type: "webhare_testsuite:global.generic_test_type", objects: 0, instances: 0, embedded: 2, total: 1 }], JSON.parse(result.stdout));

  result = runFindInstances(["webhare_testsuite:global.generic_test_type", "--count", "--json", "--start-folder", tmpPath, "--where", "$.int < 10"]);
  test.eq(0, result.status, result.stderr);
  test.eq([{ type: "webhare_testsuite:global.generic_test_type", objects: 0, instances: 0, embedded: 1, total: 1 }], JSON.parse(result.stdout));

  //Masks count multiple types, including unused ones, sorted by total
  result = runFindInstances(["platform:filetypes.*", "--count", "--json", "--start-folder", tmpPath]);
  test.eq(0, result.status, result.stderr);
  const counts = JSON.parse(result.stdout) as Array<{ type: string; total: number }>;
  test.eqPartial([{ type: "platform:filetypes.form", total: 2 }, { type: "platform:filetypes.richdocument", total: 1 }], counts.slice(0, 2));
  test.assert(counts.length > 2 && counts.slice(2).every(count => count.total === 0), "other platform file types should be listed with a total of 0");

  //Table output
  result = runFindInstances(["platform:filetypes.form", "--count", "--start-folder", tmpPath]);
  test.eq(0, result.status, result.stderr);
  test.eq(/^type +objects +instances +embedded +total\nplatform:filetypes\.form +2 +0 +0 +2\n$/, result.stdout);

  //--kind limits the types to look for
  result = runFindInstances(["webhare_testsuite:global.*", "--count", "--json", "--kind", "instance", "--start-folder", tmpPath]);
  test.eq(0, result.status, result.stderr);
  test.eqPartial([{ type: "webhare_testsuite:global.generic_test_type", total: 1 }], (JSON.parse(result.stdout) as unknown[]).slice(0, 1));

  result = runFindInstances(["platform:filetypes.form", "--count", "--kind", "folder"]);
  test.eq(1, result.status);
  test.eq(/No WHFS types of kind 'folder' match 'platform:filetypes.form'/, result.stderr);

  //Masks also work when listing. Selected members only need to exist in one of the types
  result = runFindInstances(["platform:filetypes.*", "--json", "--start-folder", tmpPath, "--select", "maxsignups"]);
  test.eq(0, result.status, result.stderr);
  test.eqPartial([
    { id: formNoMax.id, type: "platform:filetypes.form" }, //exported data leaves out default values
    { id: formWithMax.id, type: "platform:filetypes.form", data: { maxsignups: 5 } },
    { id: widgetHolder.id, type: "platform:filetypes.richdocument" }
  ], JSON.parse(result.stdout));

  result = runFindInstances(["platform:filetypes.*", "--ids", "--start-folder", tmpPath, "--where", "$.maxsignups > 0 || obj.type === 'platform:filetypes.richdocument'"]);
  test.eq(0, result.status, result.stderr);
  test.eq([formWithMax.id, widgetHolder.id].sort(), result.stdout.trim().split("\n").map(Number).sort());

  result = runFindInstances(["platform:filetypes.*", "--start-folder", tmpPath, "--select", "nosuchmember"]);
  test.eq(1, result.status);
  test.eq(/No such member 'nosuchmember'/, result.stderr);

  result = runFindInstances(["platform:filetypes.*", "--kind", "file", "--start-folder", tmpPath, "--republish", "--ids"]);
  test.eq(0, result.status, result.stderr);
  test.eq([formNoMax.id, formWithMax.id, widgetHolder.id].sort(), result.stdout.trim().split("\n").map(Number).sort());
  test.eq(/Scheduled 0 folder\(s\) and \d+ file\(s\) for republication/, result.stderr);

  result = runFindInstances(["webhare_testsuite:nosuchtype*", "--count"]);
  test.eq(1, result.status);
  test.eq(/No WHFS types match/, result.stderr);

  for (const conflicting of [["--ids"], ["--select", "maxsignups"], ["--republish"]]) {
    result = runFindInstances(["platform:filetypes.form", "--count", ...conflicting]);
    test.eq(1, result.status);
    test.eq(new RegExp(`--count cannot be combined with ${conflicting[0]}`), result.stderr);
  }

  //Error handling
  result = runFindInstances(["platform:filetypes.form", "--start-folder", tmpPath, "--where", "$.maxsignups >"]);
  test.eq(1, result.status);
  test.eq(/Invalid --where expression/, result.stderr);

  result = runFindInstances(["platform:filetypes.form", "--start-folder", tmpPath, "--where", "$.nosuchmember.foo"]);
  test.eq(1, result.status);
  test.eq(/--where expression failed for .*form-/, result.stderr);

  result = runFindInstances(["platform:filetypes.form", "--select", "nosuchmember"]);
  test.eq(1, result.status);
  test.eq(/No such member 'nosuchmember'/, result.stderr);
}

test.runTests([
  test.resetWTS,
  testWHFSCli,
  testFindInstances,
]);

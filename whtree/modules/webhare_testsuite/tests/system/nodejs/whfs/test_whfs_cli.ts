import * as test from "@mod-webhare_testsuite/js/wts-backend";
import { buildRTD, ResourceDescriptor } from "@webhare/services";
import type { RTDExport } from "@webhare/services/src/richdocument";
import { beginWork, commitWork } from "@webhare/whdb";
import { whfsType } from "@webhare/whfs";
import { spawnSync } from "node:child_process";

async function testWHFSCli() {
  //setup test data
  await beginWork();
  const tmpfolder = await test.getTestSiteJSTemp();
  const newFile = await tmpfolder.createFile("new-file", { type: "platform:filetypes.richdocument", title: "Export test", data: null });
  const newFile2 = await tmpfolder.createFile("new-file-2", { type: "platform:filetypes.richdocument", title: "Export test", data: null });
  const fish = await ResourceDescriptor.fromResource("mod::system/web/tests/goudvis.png", { getHash: true, getImageMetadata: true });
  await whfsType("platform:filetypes.richdocument").set(newFile.id, {
    data: await buildRTD([{ p: ["Dit is een test met image: ", { image: fish }] }])
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
}

function runFindInstances(args: string[]) {
  const result = spawnSync("wh", ["whfs", "find-instances", ...args], { shell: false, encoding: "utf-8", stdio: ['inherit', 'pipe', 'pipe'] });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

async function testFindInstances() {
  await beginWork();
  const tmpfolder = await test.getTestSiteJSTemp();
  const formWithMax = await tmpfolder.createFile("form-with-max", { type: "platform:filetypes.form" });
  await whfsType("platform:filetypes.form").set(formWithMax.id, { maxsignups: 5 });
  const formNoMax = await tmpfolder.createFile("form-no-max", { type: "platform:filetypes.form" });
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
  let result = runFindInstances(["platform:filetypes.form", "--json", "--under", tmpPath, "--where", "$.maxsignups > 0", "--select", "maxsignups"]);
  test.eq(0, result.status, result.stderr);
  test.eqPartial([{ id: formWithMax.id, source: "object", data: { maxsignups: 5 } }], JSON.parse(result.stdout));

  //Without a filter, both forms should be found
  result = runFindInstances(["platform:filetypes.form", "--ids", "--under", tmpPath]);
  test.eq(0, result.status, result.stderr);
  test.eq([formNoMax.id, formWithMax.id].sort(), result.stdout.trim().split("\n").map(Number).sort());

  //Filter on the object info
  result = runFindInstances(["platform:filetypes.form", "--ids", "--under", tmpPath, "--where", "obj.name === 'form-no-max'"]);
  test.eq(0, result.status, result.stderr);
  test.eq(`${formNoMax.id}\n`, result.stdout);

  //Nothing found prints nothing
  result = runFindInstances(["platform:filetypes.form", "--ids", "--under", tmpPath, "--where", "$.maxsignups > 1000"]);
  test.eq(0, result.status, result.stderr);
  test.eq("", result.stdout);

  //Embedded instances (widgets)
  result = runFindInstances(["webhare_testsuite:global.generic_test_type", "--json", "--under", tmpPath, "--select", "int", "--select", "str"]);
  test.eq(0, result.status, result.stderr);
  test.eqPartial([
    { id: widgetHolder.id, source: "embedded", embeddedIn: "platform:filetypes.richdocument#data", data: { int: 42, str: "first" } },
    { id: widgetHolder.id, source: "embedded", embeddedIn: "platform:filetypes.richdocument#data", data: { int: 7, str: "second" } }
  ], JSON.parse(result.stdout));

  result = runFindInstances(["webhare_testsuite:global.generic_test_type", "--json", "--under", tmpPath, "--where", "$.int < 10", "--select", "str"]);
  test.eq(0, result.status, result.stderr);
  test.eqPartial([{ id: widgetHolder.id, data: { str: "second" } }], JSON.parse(result.stdout));

  //Error handling
  result = runFindInstances(["platform:filetypes.form", "--under", tmpPath, "--where", "$.maxsignups >"]);
  test.eq(1, result.status);
  test.eq(/Invalid --where expression/, result.stderr);

  result = runFindInstances(["platform:filetypes.form", "--under", tmpPath, "--where", "$.nosuchmember.foo"]);
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

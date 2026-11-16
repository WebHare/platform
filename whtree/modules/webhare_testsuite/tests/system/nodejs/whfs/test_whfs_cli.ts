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


test.runTests([
  test.resetWTS,
  testWHFSCli,
]);

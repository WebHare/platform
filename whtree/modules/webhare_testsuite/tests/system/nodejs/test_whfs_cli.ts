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
      test.assert("base64" in imageNode.image.data);
    } else {
      test.assert(!("base64" in imageNode.image.data));
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


test.runTests([
  test.resetWTS,
  testWHFSCli,
]);

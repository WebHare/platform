import { YAML } from "@webhare/deps";
import * as test from "@mod-webhare_testsuite/js/wts-backend";
import { toFSPath } from "@webhare/services";
import { beginWork, commitWork, rollbackWork } from "@webhare/whdb";
import { importIntoWHFS, storeWHFSExport, whfsType, type WHFSFolder } from "@webhare/whfs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from 'node:fs';

async function verifyImportTree(importTree: WHFSFolder) {
  //FIXME verify file types, but TS WebHare should do type detection of files without metadata!
  const snowBeagle = await importTree.openFile("no-meta-dir/no-meta-subdir/snowbeagle.webp");
  test.eq(22060, snowBeagle.data.resource.size);

  //Verify the RTD in the root appeared
  const rootfile = await importTree.openFile("rootfile");
  test.eq("Root file", rootfile.title);
  test.eq(true, rootfile.publish);
  test.eq([{ tag: "p", items: [{ text: "This is a file in the root" }] }], (await whfsType("platform:filetypes.richdocument").get(rootfile.id, { export: true })).data);

  //Verify directory with metadata
  const subdir = await importTree.openFolder("subdir");
  test.eq("My subfolder", subdir.title);

  //Verify the goudvis.
  //FIXME export/import goudvis with changed dominantColor/fileName setting and ensure we see that in the resource descriptor (as scanData currently seems to be ignored in the export)
  const goudvis = await subdir.openFile("goudvis.png");
  test.eq("Een goudvis", goudvis.title);
  test.eq(true, goudvis.publish);
  test.eq(75125, goudvis.data.resource.size);

  //Verify the goudvis link
  const goudvisCLink = await subdir.openFile("goudvis-contentlink");
  test.eq(goudvis.id, goudvisCLink.target?.internalLink);
}

async function testWHFSImportArchive() {
  //See https://my.webhare.dev/?app=publisher(/webhare-tests/webhare_testsuite.testsitejs/tmp/)

  await beginWork();
  const target = await test.getTestSiteJSTemp();
  console.log("Importing into", target.whfsPath);
  await commitWork();

  {
    await beginWork();
    const importTree = await target.createFolder("import-tree-1");
    const importResult = await importIntoWHFS(toFSPath("mod::webhare_testsuite/tests/system/nodejs/data/whfs/import-tree"), importTree);
    test.eq([], importResult.messages);
    await commitWork();

    await verifyImportTree(importTree);

    { //Reimport, should report existence errors
      await beginWork();
      const reimportResult = await importIntoWHFS(toFSPath("mod::webhare_testsuite/tests/system/nodejs/data/whfs/import-tree"), importTree);
      test.assert(reimportResult.messages.find(msg => msg.type === "error" && /already exists/.test(msg.message)));
      await rollbackWork();
    }
  }
}

async function testWHFSExportArchive() {
  const workdir = await mkdtemp(join(tmpdir(), "whfs-export-archive."));
  console.log(`Export work dir: ${workdir}`);

  const target = await test.getTestSiteJSTemp();
  const source = await target.openFolder("import-tree-1");
  await storeWHFSExport(join(workdir, "import-tree-1"), [source]);

  //verify proper relative link
  const goldFishContentLinkMetadata = YAML.parse(readFileSync(join(workdir, "import-tree-1", "import-tree-1", "subdir/goudvis-contentlink.whfs.yml"), "utf-8"));
  test.eq({ internalLink: "goudvis.png" }, goldFishContentLinkMetadata.instances[0].data.target);

  //Reimport it
  {
    await beginWork();
    const importTree = await target.createFolder("re-import-1");
    const importResult = await importIntoWHFS(join(workdir, "import-tree-1"), importTree);
    test.eq([], importResult.messages);
    await commitWork();

    //TODO hmm, does it make sense that eport followed by import would add a level?
    await verifyImportTree(await importTree.openFolder("import-tree-1"));
  }
}

test.runTests([
  test.resetWTS,
  testWHFSImportArchive,
  testWHFSExportArchive,
]);

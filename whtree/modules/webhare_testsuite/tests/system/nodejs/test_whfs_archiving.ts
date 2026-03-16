import { YAML } from "@webhare/deps";
import * as test from "@mod-webhare_testsuite/js/wts-backend";
import { toFSPath } from "@webhare/services";
import { beginWork, commitWork, rollbackWork } from "@webhare/whdb";
import { importIntoWHFS, storeWHFSExport, whfsType, type ImportWHFSProgress, type WHFSFolder } from "@webhare/whfs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from 'node:fs';

function onImportProgress(progress: ImportWHFSProgress) {
  console.log(`- import: ${progress.subPath}`);
}

async function verifyImportTree(importTree: WHFSFolder) {
  //FIXME verify file types, but TS WebHare should do type detection of files without metadata!
  const snowBeagle = await importTree.openFile("no-meta-dir/no-meta-subdir/snowbeagle.webp");
  test.eq(22060, snowBeagle.data.resource.size);

  //Verify the RTD in the root appeared
  const rootfile = await importTree.openFile("rootfile");
  test.eq("Root file", rootfile.title);
  test.eq(true, rootfile.publish);
  test.eq([{ tag: "p", items: [{ text: "This is a file in the root" }] }], (await whfsType("platform:filetypes.richdocument").get(rootfile.id, { export: true })).data);
  test.eq(rootfile.created, rootfile.modified, "created === modified as we're building a new tree");

  //Verify directory with metadata
  const subdir = await importTree.openFolder("subdir");
  test.eq("My subfolder", subdir.title);
  test.eq(subdir.created, subdir.modified, "created === modified as we're building a new tree");
  test.eq(subdir.created, rootfile.created, "All items touched by a single import should have matching creationdates (if new)");
  test.eq(subdir.modified, rootfile.modified, "All items touched by a single import should have matching modificationdates");

  const subdirIndex = await subdir.openFile("index");
  test.eq(subdirIndex.id, subdir.indexDoc);
  test.eq(subdirIndex.modified, rootfile.modified, "All items touched by a single import should have matching modificationdates");

  const subdirIndexRTD = (await whfsType("platform:filetypes.richdocument").get(subdirIndex.id)).data;
  test.assert(subdirIndexRTD);
  test.eq({ tag: "p", items: [{ text: "This is a file in the subdir" }] }, subdirIndexRTD.blocks[0]);
  const subdirIndexRTDWidget1 = subdirIndexRTD.blocks[1];
  test.assert("widget" in subdirIndexRTDWidget1);
  test.eq("webhare_testsuite:global.generic_test_type", subdirIndexRTDWidget1.widget.whfsType);
  test.eq(snowBeagle.id, subdirIndexRTDWidget1.widget.as("webhare_testsuite:global.generic_test_type").data.myLink?.internalLink);

  //Verify the goudvis
  //FIXME export/import goudvis with changed dominantColor/fileName setting and ensure we see that in the resource descriptor (as scanData currently seems to be ignored in the export)
  const goudvis = await subdir.openFile("goudvis.png");
  test.eq("Een goudvis", goudvis.title);
  test.eq(true, goudvis.publish);
  test.eq(75125, goudvis.data.resource.size);
  test.eq(subdirIndex.modified, rootfile.modified, "All items touched by a single import should have matching modificationdates");

  //Verify the goudvis link
  const goudvisCLink = await subdir.openFile("goudvis-contentlink");
  test.eq(goudvis.id, goudvisCLink.target?.internalLink);
}

async function testWHFSImportArchive() {
  await beginWork();
  const target = await test.getTestSiteJSTemp();
  await commitWork();

  {
    await beginWork();
    const importTree = await target.createFolder("import-tree-1");
    console.log(`Importing tree into ${importTree.whfsPath}... https://my.webhare.dev/?app=publisher(${encodeURIComponent(importTree.whfsPath)}`);
    const importResult = await importIntoWHFS(toFSPath("mod::webhare_testsuite/tests/system/nodejs/data/whfs/import-tree"), importTree, { onProgress: onImportProgress });
    test.eq([], importResult.messages);
    await commitWork();

    await verifyImportTree(importTree);

    { //Reimport, should report existence errors
      await beginWork();
      console.log(`Re-importing tree into ${importTree.whfsPath}...`);
      const reimportResult = await importIntoWHFS(toFSPath("mod::webhare_testsuite/tests/system/nodejs/data/whfs/import-tree"), importTree, { onProgress: onImportProgress });
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
    console.log(`Importing exported tree into ${importTree.whfsPath}... https://my.webhare.dev/?app=publisher(${encodeURIComponent(importTree.whfsPath)}`);
    const importResult = await importIntoWHFS(join(workdir, "import-tree-1"), importTree, { onProgress: onImportProgress });
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

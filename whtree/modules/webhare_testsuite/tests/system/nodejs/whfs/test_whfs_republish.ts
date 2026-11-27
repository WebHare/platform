import * as test from "@mod-webhare_testsuite/js/wts-backend";
import { beginWork, commitWork, db, rollbackWork } from "@webhare/whdb";
import { openFile, republishWHFSObjects, waitForPublication, type WHFSFile, type WHFSFolder } from "@webhare/whfs";
import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { getPrioOrErrorFromPublished, isQueuedForPublication, PublishedFlag_HasWebDesign, PubPrio_FolderRepub, PubPrio_Scheduled, PubPrio_SubFolderRepub, testFlagFromPublished } from "@webhare/whfs/src/support";

let folder: WHFSFolder;
let subFolder: WHFSFolder;
let designFile: WHFSFile;
let staticFile: WHFSFile;
let subFile: WHFSFile;
let brokenLink: WHFSFile;

async function getPublished(id: number): Promise<number> {
  return (await db<PlatformDB>().selectFrom("system.fs_objects").select("published").where("id", "=", id).executeTakeFirstOrThrow()).published;
}

/** Returns the publication priority of each test file, 0 if it isn't queued */
async function getQueuedPrios() {
  const result: Record<string, number> = {};
  for (const [name, file] of Object.entries({ designFile, staticFile, subFile, brokenLink })) {
    const published = await getPublished(file.id);
    result[name] = isQueuedForPublication(published) ? getPrioOrErrorFromPublished(published) : 0;
  }
  return result;
}

async function setup() {
  await test.resetWTS();

  await beginWork();
  const tmp = await test.getTestSiteJSTemp();
  folder = await tmp.createFolder("republish");
  subFolder = await folder.createFolder("sub");
  designFile = await folder.createFile("design.rtd", { type: "platform:filetypes.richdocument", publish: true });
  staticFile = await folder.createFile("static.txt", { type: "platform:filetypes.plaintext", publish: true });
  subFile = await subFolder.createFile("sub.rtd", { type: "platform:filetypes.richdocument", publish: true });
  brokenLink = await folder.createFile("broken.link", { type: "platform:filetypes.internallink", publish: true }); //a link without a target fails to publish
  await commitWork();

  await test.waitForPublishCompletion(folder, { expectErrorsFor: [brokenLink.id] });
  test.assert(testFlagFromPublished(await getPublished(designFile.id), PublishedFlag_HasWebDesign), "A rich document depends on the web design");
  test.assert(!testFlagFromPublished(await getPublished(staticFile.id), PublishedFlag_HasWebDesign), "A plain text file doesn't depend on the web design");
  test.eq({ designFile: 0, staticFile: 0, subFile: 0, brokenLink: 0 }, await getQueuedPrios());
}

// Verifies which files a folder republish queues, without committing the republish
async function testFolderRepublish() {
  ////////////////////////////////////////////////////////////////
  // STORY: By default only files that depend on the web design or failed are republished, not those in subfolders
  await beginWork();
  await folder.republish();
  test.eq({ designFile: PubPrio_FolderRepub, staticFile: 0, subFile: 0, brokenLink: PubPrio_FolderRepub }, await getQueuedPrios());
  await rollbackWork();

  ////////////////////////////////////////////////////////////////
  // STORY: 'recursive' republishes subfolders at a lower priority
  await beginWork();
  await folder.republish({ recursive: true });
  test.eq({ designFile: PubPrio_FolderRepub, staticFile: 0, subFile: PubPrio_SubFolderRepub, brokenLink: PubPrio_FolderRepub }, await getQueuedPrios());
  await rollbackWork();

  ////////////////////////////////////////////////////////////////
  // STORY: which: "all" includes files that don't depend on the web design
  await beginWork();
  await folder.republish({ which: "all" });
  test.eq({ designFile: PubPrio_FolderRepub, staticFile: PubPrio_FolderRepub, subFile: 0, brokenLink: PubPrio_FolderRepub }, await getQueuedPrios());
  await rollbackWork();

  ////////////////////////////////////////////////////////////////
  // STORY: which: "failed" only republishes files whose publication failed
  await beginWork();
  await folder.republish({ which: "failed" });
  test.eq({ designFile: 0, staticFile: 0, subFile: 0, brokenLink: PubPrio_FolderRepub }, await getQueuedPrios());
  await rollbackWork();
}

async function testRepublishObjects() {
  ////////////////////////////////////////////////////////////////
  // STORY: Files you list are always republished, at a higher priority
  await beginWork();
  await republishWHFSObjects([staticFile.id, subFolder]);
  test.eq({ designFile: 0, staticFile: PubPrio_Scheduled, subFile: PubPrio_FolderRepub, brokenLink: 0 }, await getQueuedPrios());
  await rollbackWork();

  ////////////////////////////////////////////////////////////////
  // STORY: WHFSFile.republish expedites the file
  await beginWork();
  await (await openFile(designFile.id)).republish();
  test.eq({ designFile: PubPrio_Scheduled, staticFile: 0, subFile: 0, brokenLink: 0 }, await getQueuedPrios());
  await rollbackWork();

  ////////////////////////////////////////////////////////////////
  // STORY: The WHFS root requires allowRoot, and unknown objects are refused
  await beginWork();
  await test.throws(/allowRoot/, republishWHFSObjects([0]));
  await test.throws(/No such file or folder/, republishWHFSObjects([-1]));
  await rollbackWork();

  ////////////////////////////////////////////////////////////////
  // STORY: The WHFS root has no files of its own, recursively it republishes the sites (outside a site, recursion goes to the sites below)
  await beginWork();
  await republishWHFSObjects([0], { allowRoot: true });
  test.eq({ designFile: 0, staticFile: 0, subFile: 0, brokenLink: 0 }, await getQueuedPrios());
  await republishWHFSObjects([0], { allowRoot: true, recursive: true });
  test.eq({ designFile: PubPrio_SubFolderRepub, staticFile: 0, subFile: PubPrio_SubFolderRepub, brokenLink: PubPrio_SubFolderRepub }, await getQueuedPrios());
  await rollbackWork();
}

async function testWaitForPublication() {
  ////////////////////////////////////////////////////////////////
  // STORY: Waiting with open work or for unknown objects is refused
  await beginWork();
  await test.throws(/work is open/, waitForPublication([folder]));
  await rollbackWork();
  await test.throws(/No such file or folder/, waitForPublication([-1]));

  ////////////////////////////////////////////////////////////////
  // STORY: Wait for a committed recursive republish to finish
  const before = await db<PlatformDB>().selectFrom("system.fs_objects").select("lastpublishdate").where("id", "=", subFile.id).executeTakeFirstOrThrow();
  await beginWork();
  await folder.republish({ recursive: true });
  await commitWork();

  const result = await waitForPublication([folder], { deadline: 60_000 });
  test.eq({ completed: true, failed: [{ id: brokenLink.id, whfsPath: brokenLink.whfsPath }] }, { ...result, failed: result.failed.map(f => ({ id: f.id, whfsPath: f.whfsPath })) });
  test.assert(result.failed[0].error > 100, "The failure has an error code");
  test.eq({ designFile: 0, staticFile: 0, subFile: 0, brokenLink: 0 }, await getQueuedPrios());
  const after = await db<PlatformDB>().selectFrom("system.fs_objects").select("lastpublishdate").where("id", "=", subFile.id).executeTakeFirstOrThrow();
  test.assert(after.lastpublishdate > before.lastpublishdate, "The file in the subfolder was republished");

  ////////////////////////////////////////////////////////////////
  // STORY: A file the publisher never picks up (we queue it without telling the publisher) runs into the deadline or an abort
  const staticPublished = await getPublished(staticFile.id);
  await beginWork();
  await db<PlatformDB>().updateTable("system.fs_objects").set({ published: staticPublished + PubPrio_Scheduled }).where("id", "=", staticFile.id).execute();
  await commitWork();

  test.eq({ completed: false, failed: [] }, await waitForPublication([staticFile], { deadline: 100 }));

  const controller = new AbortController();
  setTimeout(() => controller.abort(new Error("Stop waiting")), 100);
  await test.throws(/Stop waiting/, waitForPublication([staticFile], { signal: controller.signal }));

  await beginWork();
  await db<PlatformDB>().updateTable("system.fs_objects").set({ published: staticPublished }).where("id", "=", staticFile.id).execute();
  await commitWork();
}

test.runTests([
  setup,
  testFolderRepublish,
  testRepublishObjects,
  testWaitForPublication,
]);

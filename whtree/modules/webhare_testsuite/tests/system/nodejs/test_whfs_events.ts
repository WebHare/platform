import * as test from "@mod-webhare_testsuite/js/wts-backend";
import * as whdb from "@webhare/whdb";
import * as whfs from "@webhare/whfs";
import { loadlib } from "@webhare/harescript";
import bridge from "@mod-system/js/internal/whmanager/bridge";
import { pick } from "@mod-system/js/internal/util/algorithms";


class EventListener {
  private events: Array<{
    folder: number;
    events: string[];
    files: Array<{
      file: number;
      events: string[];
      isfolder: boolean;
    }>;
  }> = [];

  private waitForEvent: PromiseWithResolvers<void> | undefined;
  private listenIds: number[] = [];

  constructor() {
    bridge.on("event", data => {
      if (data.name.startsWith("system:whfs.folder."))
        this.events.push(data.data as any);
      this.waitForEvent?.resolve();
    });
  }

  async expectEvents(msgCount: number) {
    const result: Array<{
      folder: number;
      events: string[];
      files: Array<{
        file: number;
        events: string[];
        isfolder: boolean;
      }>;
    }> = [];
    let deadLine = Date.now() + 30000;
    for (; ;) {
      if (!this.events.length) {
        this.waitForEvent = Promise.withResolvers();
        await Promise.race([this.waitForEvent.promise, test.sleep(deadLine - Date.now())]);
        if (!this.events.length)
          break;
        this.waitForEvent = undefined;
      }
      const event = this.events.shift()!;
      if (this.listenIds.indexOf(event.folder) === -1)
        continue;
      if (result.length === msgCount) {
        console.dir(result, { depth: null });
        throw new Error(`Received too many events, expected ${msgCount} got ${result.length + 1}`);
      }
      result.push(pick(event, ["folder", "events", "files"]));
      if (result.length === msgCount)
        deadLine = Date.now() + 100;
    }
    if (result.length < msgCount) {
      console.dir(result, { depth: null });
      throw new Error(`Received too few events, expected ${msgCount} got ${result.length}`);
    }

    return result;
  }

  listenTo(folderId: number) {
    if (this.listenIds.indexOf(folderId) === -1)
      this.listenIds.push(folderId);
  }
}


async function testWHFSEvents() {

  await whdb.beginWork();
  const id = await (await loadlib("mod::system/lib/testframework.whlib").EnsureTestSite("webhare_testsuite.test_whfs_events", { recyclesite: true })).$get("id");
  const testSite = await whfs.openSite(id);
  const rootFolder = await testSite.openFolder(".");
  //const moveTarget = await rootFolder.createFolder("movetarget");
  await whdb.commitWork();


  const listener = new EventListener;

  {
    // STORY: create file
    await whdb.beginWork();
    const testFile = await rootFolder.createFile("testfile.txt");
    await whdb.commitWork();

    listener.listenTo(rootFolder.id);
    test.eq([
      {
        folder: rootFolder.id,
        events: [],
        files: [{ file: testFile.id, events: ["create"], isfolder: false }]
      }
    ], await listener.expectEvents(1));

    // STORY: update title
    await whdb.beginWork();
    await testFile.update({ title: "updated title" });
    await whdb.commitWork();

    listener.listenTo(rootFolder.id);
    test.eq([
      {
        folder: rootFolder.id,
        events: [],
        files: [{ file: testFile.id, events: ["update"], isfolder: false }]
      }
    ], await listener.expectEvents(1));

    // STORY: update name
    await whdb.beginWork();
    await testFile.update({ name: "testfile2.txt" });
    await whdb.commitWork();

    listener.listenTo(rootFolder.id);
    test.eq([
      {
        folder: rootFolder.id,
        events: [],
        files: [{ file: testFile.id, events: ["rename", "update"], isfolder: false }]
      }
    ], await listener.expectEvents(1));

    // STORY: move - not supported yet

    // STORY: publish
    await whdb.beginWork();
    await testFile.update({ publish: true });
    await whdb.commitWork();

    test.eq([
      {
        folder: rootFolder.id,
        events: [],
        files: [{ file: testFile.id, events: ["rep", "update"], isfolder: false }]
      }
    ], await listener.expectEvents(1));

    // STORY: unpublish
    await whdb.beginWork();
    await testFile.update({ publish: false });
    await whdb.commitWork();

    test.eq([
      {
        folder: rootFolder.id,
        events: [],
        files: [{ file: testFile.id, events: ["unp", "update"], isfolder: false }]
      }
    ], await listener.expectEvents(1));

    // STORY: recycle
    await whdb.beginWork();
    await testFile.recycle();
    await whdb.commitWork();

    test.eq([
      {
        folder: rootFolder.id,
        events: [],
        files: [{ file: testFile.id, events: ["del"], isfolder: false }]
      }
    ], await listener.expectEvents(1));
  }
}

test.runTests([
  test.resetWTS,
  testWHFSEvents,
]);

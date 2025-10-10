import * as test from "@mod-webhare_testsuite/js/wts-backend";
import * as whdb from "@webhare/whdb";
import * as whfs from "@webhare/whfs";
import { loadlib } from "@webhare/harescript";
import bridge from "@mod-system/js/internal/whmanager/bridge";
import { pick } from "@mod-system/js/internal/util/algorithms";
import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { whfsFinishHandler } from "@webhare/whfs/src/finishhandler";
import { subscribe } from "@webhare/services";


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

  async expectEvents(msgCount: number, options: { minMsgCounts?: number } = {}) {
    options.minMsgCounts ??= msgCount;
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
      result.push(pick(event, ["folder", "events", "files"]));
      if (result.length > msgCount) {
        console.dir(result, { depth: null });
        throw new Error(`Received too many events, expected ${options.minMsgCounts !== msgCount ? `${options.minMsgCounts}-` : ""}${msgCount} got ${result.length}`);
      }
      if (result.length === options.minMsgCounts)
        deadLine = Date.now() + 100;
    }
    if (result.length < options.minMsgCounts) {
      console.dir(result, { depth: null });
      throw new Error(`Received too few events, expected ${options.minMsgCounts !== msgCount ? `${options.minMsgCounts}-` : ""}${msgCount} got ${result.length}`);
    }

    return result;
  }

  listenTo(folderId: number) {
    if (this.listenIds.indexOf(folderId) === -1)
      this.listenIds.push(folderId);
  }
}


async function assertLastPublishDateAfter(objectId: number, expect: Temporal.Instant) {
  const rec = await whdb.db<PlatformDB>()
    .selectFrom("system.fs_objects")
    .select("lastpublishdate")
    .where("id", "=", objectId)
    .executeTakeFirst();
  if (!rec || !rec.lastpublishdate)
    throw new Error(`Object #${objectId} not found or never published`);
  if (Temporal.Instant.compare(rec.lastpublishdate.toTemporalInstant(), expect) < 0)
    throw new Error(`Object #${objectId} lastpublishdate ${rec.lastpublishdate} is before expected ${expect}`);
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
    const beforeCreate = Temporal.Now.instant();
    await whdb.beginWork();
    const testFile = await rootFolder.createFile("testfile.txt", {
      type: "http://www.webhare.net/xmlns/publisher/richdocumentfile",
      publish: true,
    });
    await whdb.commitWork();

    await test.waitForOutputAnalyzer([rootFolder.id], Temporal.Now.instant().add({ seconds: 30 }));
    await test.waitForPublishCompletion(testFile.parent);

    await assertLastPublishDateAfter(testFile.id, beforeCreate);

    listener.listenTo(rootFolder.id);
    {
      // The output analyzer may run before the publication completes, so we may get one or two events here
      const events = await listener.expectEvents(2, { minMsgCounts: 1 });
      test.eq([
        {
          folder: rootFolder.id,
          events: [],
          files: [{ file: testFile.id, events: ["create", "rep"], isfolder: false }]
        },
        ...(events.length > 1 ? [
          {
            folder: rootFolder.id,
            events: [],
            files: [{ file: testFile.id, events: ["rep"], isfolder: false }]
          },
        ] : [])
      ], events);
    }

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
    {
      const events = await listener.expectEvents(2, { minMsgCounts: 1 });
      test.eq([
        {
          folder: rootFolder.id,
          events: [],
          files: [{ file: testFile.id, events: ["rename", "update"], isfolder: false }]
        },
        ...(events.length > 1 ? [
          {
            folder: rootFolder.id,
            events: [],
            files: [{ file: testFile.id, events: ["rep"], isfolder: false }]
          },
        ] : [])
      ], events);
    }

    // STORY: move - not supported yet

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

    // STORY: publish
    await test.waitForPublishCompletion(testFile.parent, { acceptErrors: true });
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

    await test.waitForOutputAnalyzer([rootFolder.id], Temporal.Now.instant().add({ seconds: 30 }));
    await test.waitForPublishCompletion(testFile.parent);

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

async function testFinishHandler() {
  // test non-wired stuff

  await whdb.beginWork();
  const id = await (await loadlib("mod::system/lib/testframework.whlib").EnsureTestSite("webhare_testsuite.test_whfs_events", { recyclesite: true })).$get("id");
  const testSite = await whfs.openSite(id);
  const rootFolder = await testSite.openFolder(".");
  //const moveTarget = await rootFolder.createFolder("movetarget");
  await whdb.commitWork();


  // STORY: checkSiteSettings
  {
    // sitesettings
    const p = Promise.withResolvers<void>();
    using s = await subscribe(["system:internal.webserver.didconfigreload"], () => p.resolve()); void s;

    await whdb.beginWork();
    whfsFinishHandler().checkSiteSettings();
    await whdb.commitWork();

    await test.wait(() => p, { annotation: "Waiting for webserver config reload triggered by sitesettings check" });
  }

  // STORY: fsTypesChanged triggering system:whfs.types event
  {
    const p = Promise.withResolvers<void>();
    using s = await subscribe(["system:whfs.types"], () => p.resolve()); void s;

    await whdb.beginWork();
    whfsFinishHandler().fsTypesChanged();
    await whdb.commitWork();

    await test.wait(() => p, { annotation: "Waiting for system:whfs.types eent after fsTypeChanged" });
  }

  // STORY: siteUpdated triggering output analyzer
  {
    await whdb.beginWork();
    const indexFile = await rootFolder.createFile("index.html");
    await whdb.commitWork();

    await test.waitForOutputAnalyzer([rootFolder.id], Temporal.Now.instant().add({ seconds: 30 }));
    await test.waitForPublishCompletion(indexFile.parent);


    await whdb.beginWork();
    await whdb.db<PlatformDB>().updateTable("system.fs_objects").set({ indexdoc: null }).where("id", "=", rootFolder.id).execute();
    whfsFinishHandler().siteUpdated(testSite.id);
    await whdb.commitWork();

    await test.wait(async () => (await whdb.db<PlatformDB>().selectFrom("system.fs_objects").select("indexdoc").where("id", "=", rootFolder.id).executeTakeFirstOrThrow()).indexdoc, { annotation: "Waiting indexdoc to be reset by output analyzer" });

    await whdb.beginWork();
    await indexFile.recycle();
    await whdb.commitWork();

  }

  // STORY: triggerEmptyUpdateOnCommit should trigger modification date change
  {
    await whdb.beginWork();
    const testFile = await rootFolder.createFile("testfile.txt");
    const lastModified = testFile.modificationDate;
    await whdb.commitWork();

    await test.sleep(1); // make sure 1ms has elapsed
    await whdb.beginWork();
    whfsFinishHandler().triggerEmptyUpdateOnCommit(testFile.id);
    await whdb.commitWork();

    test.assert(Temporal.Instant.compare((await rootFolder.openFile("testfile.txt")).modificationDate, lastModified) > 0, { annotation: "File modification date should change after empty update" });

    await whdb.beginWork();
    await testFile.recycle();
    await whdb.commitWork();
  }

  // STORY: triggerReindexOnCommit should trigger reindexing
  {
    await whdb.beginWork();
    const testFile = await rootFolder.createFile("testfile.txt");
    await whdb.commitWork();

    await test.sleep(1); // make sure 1ms has elapsed
    await whdb.beginWork();
    whfsFinishHandler().triggerReindexOnCommit(testFile.id);
    const p = whfsFinishHandler().waitForChangesIndexed();
    await whdb.commitWork();

    await test.wait(() => p, { annotation: "Waiting for changes to be indexed" });

    await whdb.beginWork();
    await testFile.recycle();
    await whdb.commitWork();
  }

  // STORY: waitForChangesIndexed without changes should not wait indefinitely
  {
    await whdb.beginWork();
    const p = whfsFinishHandler().waitForChangesIndexed();
    await whdb.commitWork();
    await test.wait(() => p, { annotation: "No infinite wait when no index changes were requested" });
  }

  // STORY:
  {
    await whdb.beginWork();
    const testFile = await rootFolder.createFile("testfile.txt");
    await whfs.whfsType("webhare_testsuite:global.generic_test_type").set(testFile.id, { url: "http://example.com" });
    await whdb.commitWork();

    const typeDescription = await whfs.describeWHFSType("webhare_testsuite:global.generic_test_type");

    const instance = await whdb.db<PlatformDB>().selectFrom("system.fs_instances").select("id").where("fs_object", "=", testFile.id).where("fs_type", "=", typeDescription.id).executeTakeFirstOrThrow();
    const settings = await whdb.db<PlatformDB>().selectFrom("system.fs_settings").selectAll().where("fs_instance", "=", instance.id).execute();
    test.assert(settings.length === 1 && settings[0].setting === "http://example.com", { annotation: "There should be one setting of the test type instance" });

    await whdb.beginWork();
    whfsFinishHandler().addLinkCheckSettings([settings[0].id]);
    await whdb.commitWork();

    {
      const rec = await whdb.db<PlatformDB>().selectFrom("consilio.checked_objectlinks").select("id").where("consilio.checked_objectlinks.system_fs_setting", "=", settings[0].id).executeTakeFirst();
      test.assert(Boolean(rec), { annotation: "There should be a checked link for the setting" });
    }

    await whdb.beginWork();
    whfsFinishHandler().removeLinkCheckSettings([settings[0].id]);
    await whdb.commitWork();

    {
      const rec = await whdb.db<PlatformDB>().selectFrom("consilio.checked_objectlinks").select("id").where("consilio.checked_objectlinks.system_fs_setting", "=", settings[0].id).executeTakeFirst();
      test.assert(!rec, { annotation: "There should be no checked link for the setting" });
    }

    await whdb.beginWork();
    whfsFinishHandler().addLinkCheckSettings([settings[0].id]);
    await whdb.commitWork();

    {
      const rec = await whdb.db<PlatformDB>().selectFrom("consilio.checked_objectlinks").select("id").where("consilio.checked_objectlinks.system_fs_setting", "=", settings[0].id).executeTakeFirst();
      test.assert(Boolean(rec), { annotation: "There should be a checked link for the setting" });
    }

    await whdb.beginWork();
    await testFile.recycle();
    await whdb.commitWork();
  }
}

test.runTests([
  test.resetWTS,
  testWHFSEvents,
  testFinishHandler,
]);

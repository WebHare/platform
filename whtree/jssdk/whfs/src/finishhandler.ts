import { HareScriptType, setHareScriptType } from "@webhare/hscompat";
import { emplace } from "@webhare/std";
import { type FinishHandler, broadcastOnCommit } from "@webhare/whdb";
import { finishHandlerFactory } from "@webhare/whdb/src/impl";
import { db, sql } from "@webhare/whdb";
import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { convertToWillPublish, isPublish, isQueuedForPublication, PubPrio_DirectEdit } from "./support";
import { openBackendService } from "@webhare/services";
import bridge, { type IPCLinkType } from "@mod-system/js/internal/whmanager/bridge";
import { selectFSHighestParent } from "@webhare/whdb/src/functions";
import { loadlib } from "@webhare/harescript";

/** Events on parentfolder level. Update is triggered by an update to indexDoc */
export type WHFSFolderEventType = "update" | "fullrep";
export type WHFSObjectEventType = "rep" | "create" | "update" | "rename" | "move" | "moved" | "del" | "unp" | "order";
export type WHFSPublishEventType = "pub";
export type WHFSHistoryEventType = "history";
export type WHFSCompletionEvent = { type: "replacefile"; id: number } | { type: "addfile"; id: number };

type EventCompletionRequest = {
  type: "havependingcompletions";
  __responseKey: { type: "havependingcompletions-result" };
} | {
  type: "newcompletions";
  checksitesettings: boolean;
  data: Array<{ type: "addfile" | "replacefile" | "addfolder" | "updatefolder" | "deletechild"; id: number }>;
  __responseKey: { type: "newcompletions-result" };
};

type EventCompletionResponses = {
  type: "havependingcompletions-result";
  result: boolean;
} | {
  type: "newcompletions-result";
} | {
  type: "unknownaction-result";
};

export type EventCompletionLink = IPCLinkType<EventCompletionRequest, EventCompletionResponses>;


async function performEmptyWHFSMetadataUpdate(commitHandler: WHFSFinishHandler, id: number, options: { republish: true }) {
  const oldVersion = await db<PlatformDB>()
    .selectFrom("system.fs_objects")
    .select(["id", "parent", "published", "type", "isfolder", selectFSHighestParent().as("parentsite")])
    .where("id", "=", id)
    .executeTakeFirst();
  if (!oldVersion)
    return;

  let newPublished = oldVersion.published;
  if (isPublish(oldVersion.published) && options.republish) { //may need to republish
    newPublished = convertToWillPublish(newPublished, false, false, PubPrio_DirectEdit);
    commitHandler.fileRepublish(oldVersion.parentsite, oldVersion.parent, id);
  }

  await db<PlatformDB>()
    .updateTable("system.fs_objects")
    .set({
      modificationdate: new Date,
      // modifiedby: getEffectiveUserID(), FIXME: TS doesn't have this concept yet
      published: newPublished,
    })
    .where("id", "=", id)
    .execute();
  commitHandler.objectUpdate(oldVersion.parentsite, oldVersion.parent, id, oldVersion.isfolder);
  if (!oldVersion.isfolder)
    commitHandler.addCompletionEvent({ type: "replacefile", id });
}


class WHFSFinishHandler implements FinishHandler {
  /// File events
  private _folderEvents = new Map<number, { events?: Array<WHFSFolderEventType>; files: Map<number, { events: Array<WHFSObjectEventType>; isFolder: boolean }>; sites?: Set<number> }>();

  /// Publication events
  private _folderPubEvents = new Map<number, { files: Map<number, { isFolder: boolean }> }>();

  /// History events
  private _foldersHistoryEvents = new Map<number, { files: Map<number, { isFolder: boolean }> }>();

  /// Whether a fs_type change has occurred
  private _fsTypeChange = false;

  /// Files to republish
  private _toRepublishIds = new Set<number>();

  /// Folders to republish
  private _toRepublishParents = new Set<number>();

  /// List of output analyzer task
  private _outputAnalyzerTasks = new Map<number, { recursive: boolean }>();

  /// Whether a site setting check should be performed
  private _checkSiteSettings = false;

  /// List of link checked settings that have been removed
  private _linkCheckRemovedSettings = new Set<number>();

  /// List of link checked settings that should be (re)checked
  private _linkCheckSettings = new Set<number>();

  /// List of ofs object that should have an empty update performed
  private _emptyUpdates = new Set<number>();

  /// Completion events to send to the completion handler
  private _completionEvents: WHFSCompletionEvent[] = [];

  /// reindex these objects explicitly, e.g. for invisible updates
  private _reindexes = new Set<number>();

  /// Consilio reindex instructions
  private _toReindex = new Map<number, {
    isFolder: boolean;
    isDelete: boolean;
    events: WHFSObjectEventType[];
  }>();

  /// Promise that will be resolved when the indexing is done
  private _indexPromise: PromiseWithResolvers<{
    deleted: number[];
    updated: number[];
  }> | undefined;

  private addObjectEvent(site: number | null, folder: number | null, object: number, event: WHFSObjectEventType | WHFSPublishEventType | WHFSHistoryEventType, isFolder: boolean) {
    if (event === "pub") {
      const folderRec = emplace(this._folderPubEvents, site || 0, { insert: () => ({ files: new Map() }) });
      emplace(folderRec.files, object, { insert: () => ({ isFolder }) });
    } else if (event === "history") {
      const folderRec = emplace(this._foldersHistoryEvents, site || 0, { insert: () => ({ files: new Map() }) });
      emplace(folderRec.files, object, { insert: () => ({ isFolder }) });
    } else {
      const folderRec = emplace(this._folderEvents, site || 0, { insert: () => ({ files: new Map() }) });
      const events = emplace(folderRec.files, object, { insert: () => ({ events: setHareScriptType([], HareScriptType.StringArray), isFolder }) }).events;
      if (events.indexOf(event) === -1)
        events.push(event);
      if (site)
        (folderRec.sites ??= new Set).add(site);
    }
  }

  private addFolderEvent(site: number | null, folder: number, event: WHFSFolderEventType) {
    const events = (emplace(this._folderEvents, site || 0, { insert: () => ({ files: new Map() }) }).events ??= setHareScriptType([], HareScriptType.StringArray));
    if (events.indexOf(event) === -1)
      events.push(event);
  }

  private addAnalyzerTask(folderId: number | null, recursive: boolean) {
    emplace(this._outputAnalyzerTasks, folderId ?? 0, {
      insert: () => ({ recursive }),
      update: rec => ({ recursive: rec.recursive || recursive }),
    });
  }

  private async analyzeAndscheduleFolderEvents() {
    // Process all regular folder events
    const allSites = new Set<number>();
    for (const [folderId, folderRec] of this._folderEvents.entries()) {
      // Construct folder event data
      const data = {
        folder: folderId || 0,
        events: setHareScriptType(folderRec.events?.sort() ?? [], HareScriptType.StringArray),
        files: folderRec.files.entries().map(([file, rec]) => ({
          file,
          isfolder: rec.isFolder,
          events: setHareScriptType(rec.events.sort(), HareScriptType.StringArray)
        })).toArray(),
      };

      // Schedule the broadcast for the folder
      broadcastOnCommit(`system:whfs.folder.${folderId || 0}`, data);

      // Gather changed sites
      if (folderRec.sites) {
        for (const siteId of folderRec.sites)
          allSites.add(siteId);
      }

      // Gather folders with fullrep events
      if (data.events.includes("fullrep"))
        this._toRepublishParents.add(folderId);
      // Gather files to reindex
      for (const fileRec of data.files) {
        if ((["create", "update", "rename", "moved", "move", "del"] as const).some(e => fileRec.events.includes(e))) {
          emplace(this._toReindex, fileRec.file, {
            insert: () => ({ isFolder: fileRec.isfolder, isDelete: fileRec.events.includes("del"), events: fileRec.events }),
            update: rec => ({
              isFolder: rec.isFolder,
              isDelete: rec.isDelete || fileRec.events.includes("del"),
              events: [...new Set([...rec.events, ...fileRec.events])]
            })
          });
        }

        // Events have been sorted in-place when building the event data
        if (fileRec.events.includes("rep") && fileRec.events.join(",") !== "del,rep")
          this._toRepublishIds.add(fileRec.file);
      }
    }

    // Schedule the publication events
    for (const [folderId, folderRec] of this._folderPubEvents.entries()) {
      const data = {
        folder: folderId || 0,
        events: setHareScriptType([], HareScriptType.StringArray),
        files: [...folderRec.files.entries()].map(([file, rec]) => ({ file, events: ["pub"], ...rec })),
      };
      broadcastOnCommit(`publisher:publish.folder.${folderId || 0}`, data);
    }
    // Schedule the history events
    for (const [folderId, folderRec] of this._foldersHistoryEvents.entries()) {
      const data = {
        folder: folderId || 0,
        events: setHareScriptType([], HareScriptType.StringArray),
        files: [...folderRec.files.entries()].map(([file, rec]) => ({ file, events: ["history"], ...rec })),
      };
      broadcastOnCommit(`system:whfs-history.folder.${folderId || 0}`, data);
    }

    // Schedule the site events
    for (const siteId of allSites)
      broadcastOnCommit(`system:whfs.site.${siteId}`);

    // Schedule the system:whfs.types event when requested
    if (this._fsTypeChange)
      broadcastOnCommit("system:whfs.types", {});
  }

  private async handleRepublications() {
    // Gather files that should be republished
    const toRepublishCandidates: Array<{
      id: number;
      published: number;
      lastpublishtime: number;
    }> = [];
    if (this._toRepublishIds.size) {
      toRepublishCandidates.push(...await db<PlatformDB>()
        .selectFrom("system.fs_objects")
        .select(["id", "published", "lastpublishtime"])
        .where("id", "=", sql<number>`any(${this._toRepublishIds.values().toArray()})`)
        .execute());
    }
    if (this._toRepublishParents.size) {
      toRepublishCandidates.push(...await db<PlatformDB>()
        .selectFrom("system.fs_objects")
        .select(["id", "published", "lastpublishtime"])
        .where("parent", "=", sql<number>`any(${this._toRepublishParents.values().toArray()})`)
        .execute());
    }
    // Filter out non-published files and format for the publication service
    const toRepublish = toRepublishCandidates.filter(r => isQueuedForPublication(r.published)).map(r => ({
      id: r.id,
      priority: r.published % 100000,
      lastpublishtime: r.lastpublishtime
    }));
    if (toRepublish.length) {
      const service = await openBackendService("publisher:publication");
      try {
        await service.scheduleMultiple(toRepublish);
      } finally {
        service.close();
      }
    }
  }

  async onBeforeCommit() {
    // First, perform empty updates because that may schedule more events
    for (const id of this._emptyUpdates)
      await performEmptyWHFSMetadataUpdate(this, id, { republish: true });

    // Handle link settings. For now, via HS
    if (this._linkCheckRemovedSettings.size)
      await loadlib("mod::consilio/lib/internal/fetcher_linkcheck.whlib").DeleteCheckedObjectLinks(setHareScriptType([], HareScriptType.Integer64Array), setHareScriptType(this._linkCheckRemovedSettings.values().toArray(), HareScriptType.Integer64Array));
    if (this._linkCheckSettings.size)
      await loadlib("mod::consilio/lib/internal/fetcher_linkcheck.whlib").ProcessLinkCheckedSettings(setHareScriptType(this._linkCheckSettings.values().toArray(), HareScriptType.Integer64Array));

    await this.analyzeAndscheduleFolderEvents();
  }

  async onCommit() {
    await this.handleRepublications();

    if (this._completionEvents.length || this._checkSiteSettings) {
      const link = bridge.connect<EventCompletionLink>("system:eventcompletion", { global: true });
      try {
        await link.activate();
        link.send({ type: "newcompletions", data: setHareScriptType(this._completionEvents, HareScriptType.RecordArray), checksitesettings: this._checkSiteSettings });
      } finally {
        link.close();
      }
    }
    if (this._outputAnalyzerTasks.size) {
      const service = await openBackendService("publisher:outputanalyzer");
      try {
        await service.scheduleMultiple(this._outputAnalyzerTasks.entries().map(([folderid, rec]) => ({ action: "SCAN" as const, folderid, recursive: rec.recursive, priority: 10000 })).toArray());
      } finally {
        service.close();
      }
    }

    if (this._toReindex.size || this._reindexes.size) {
      const additional = this._reindexes.values().filter(id => this._toReindex.has(id)).toArray();
      const recs = await db<PlatformDB>().selectFrom("system.fs_objects").select(["id", "isfolder"]).where("id", "=", sql<number>`any(${additional})`).execute();
      for (const rec of recs)
        this._toReindex.set(rec.id, { isFolder: rec.isfolder, isDelete: false, events: ["update"] });

      const eventId = `${bridge.getGroupId()}.${crypto.randomUUID()}`;
      if (this._indexPromise) {
        const cbId = bridge.on("event", data => {
          if (data.name === `system:whfs.index.response.${eventId}`) {
            bridge.off(cbId);
            this._indexPromise?.resolve(data.data as { deleted: number[]; updated: number[] });
          }
        });
      }

      bridge.sendEvent(`system:whfs.index.request.${eventId}`, {
        to_reindex: this._toReindex.entries().map(([id, rec]) => ({ id, ...rec })).toArray(),
        refresh: Boolean(this._indexPromise),
      });
    } else
      this._indexPromise?.resolve({ deleted: [], updated: [] });
  }

  async onRollback() {
    this._indexPromise?.resolve({ deleted: [], updated: [] });
  }

  // ---------------------------------------------------------------------------
  //
  // 'Public' API - (code outside core modules is still not supposed to interact with the commit handler)
  //

  /** Called when a file has finished publication
   * Sideeffects upon commit:
   * - emits a 'pub' event for the file, and a system:whfs.site.<siteid> event
   */
  filePublicationFinished(parentSite: number | null, folderId: number | null, fileId: number) {
    this.addObjectEvent(parentSite, folderId, fileId, "pub", false);
  }

  /** Called when a folder is fully republished
   * Sideeffects upon commit:
   * - emits a 'fullrep' event for the folder, and a system:whfs.site.<siteid> event
   * - all files marked as published in the folder will be queued for republishing
   */
  folderRepublish(parentSite: number | null, folderId: number) {
    this.addFolderEvent(parentSite, folderId, "fullrep");
  }

  /** Called when a file is republished
   * Sideeffects upon commit:
   * - emits a 'rep' event for the file, and a system:whfs.site.<siteid> event
   * - the file will be queued for republishing if marked as published
   */
  fileRepublish(parentSite: number | null, folderId: number | null, fileId: number) {
    this.addObjectEvent(parentSite, folderId, fileId, "rep", false);
  }

  /** Called when a file or folder is created
   * Sideeffects upon commit:
   * - emits a 'create' event for the file or folder, and a system:whfs.site.<siteid> event
   * - a file will be queued for republishing if marked as published
   */
  objectCreate(parentSite: number | null, folderId: number | null, objectId: number, isFolder: boolean) {
    this.addObjectEvent(parentSite, folderId, objectId, "create", isFolder);
  }

  /** Called when a file or folder is updated
   * Sideeffects upon commit:
   * - emits a 'update' event for the file or folder, and a system:whfs.site.<siteid> event
   * - a file will be queued for republishing if marked as published
   */
  objectUpdate(parentSite: number | null, folderId: number | null, objectId: number, isFolder: boolean) {
    this.addObjectEvent(parentSite, folderId, objectId, "update", isFolder);
  }

  /** Called when a file or folder is updated
   * Sideeffects upon commit:
   * - emits a 'history' event for the file or folder (event name: system:whfs-history.folder.<folderId>), and a system:whfs.site.<siteid> event
   */
  objectHistoryChange(parentSite: number | null, folderId: number | null, objectId: number, isFolder: boolean) {
    this.addObjectEvent(parentSite, folderId, objectId, "history", isFolder);
  }

  /** Called when the name of a file or folder is updated
   * Sideeffects upon commit:
   * - emits a 'rename' event for the file or folder (event name: system:whfs-history.folder.<folderId>), and a system:whfs.site.<siteid> event
   * - a file will be queued for republishing if marked as published
   * - the output analyzer will be triggered for the parent folder
   */
  objectRename(parentSite: number | null, folderId: number | null, objectId: number, isFolder: boolean) {
    this.addObjectEvent(parentSite, folderId, objectId, "rename", isFolder);
    this.addAnalyzerTask(folderId, isFolder);
  }

  /** Called when a file or folder is moved
   * Sideeffects upon commit:
   * - emits 'move' (at source) and 'moved' (at target) event for the file or folder, and a system:whfs.site.<siteid> event
   * - a file will be queued for republishing if marked as published
   * - the output analyzer will be triggered for the old folder and the new folder
   */
  objectMove(oldParentSite: number | null, oldFolderId: number | null, newParentSite: number | null, newFolderId: number | null, objectId: number, isFolder: boolean) {
    this.addObjectEvent(oldParentSite, oldFolderId, objectId, "move", isFolder);
    this.addObjectEvent(newParentSite, newFolderId, objectId, "moved", isFolder);
    this.addAnalyzerTask(oldFolderId, isFolder);
    this.addAnalyzerTask(newFolderId, isFolder);
  }

  /** Called when a file or folder is moved
   * Sideeffects upon commit:
   * - emits 'del' event for the file or folder, and a system:whfs.site.<siteid> event
   * - the output analyzer will be triggered for the folder
   */
  objectDelete(parentSite: number | null, folderId: number | null, objectId: number, isFolder: boolean) {
    this.addObjectEvent(parentSite, folderId, objectId, "del", isFolder);
    this.addAnalyzerTask(folderId, isFolder);
  }

  /** Called when a file or folder is unpublished
   * Sideeffects upon commit:
   * - emits 'unp' event for the file or folder, and a system:whfs.site.<siteid> event
   * - the output analyzer will be triggered for the folder
   */
  fileUnpublish(parentSite: number | null, folderId: number | null, objectId: number) {
    this.addObjectEvent(parentSite, folderId, objectId, "unp", false);
    this.addAnalyzerTask(folderId, false);
  }

  /** Called when a file or folder is reordered
   * Sideeffects upon commit:
   * - emits 'order' event for the file or folder, and a system:whfs.site.<siteid> event
   */
  objectReordered(parentSite: number | null, folderId: number | null, objectId: number, isFolder: boolean) {
    this.addObjectEvent(parentSite, folderId, objectId, "order", isFolder);
  }

  /** Called when the indexdoc of a folder has been updated
   * Sideeffects upon commit:
   * - emits an 'update' event for the folder, and a system:whfs.site.<siteid> event
   * - the output analyzer will be triggered for the folder
   */
  folderIndexDocUpdated(parentSite: number | null, parentFolder: number | null, folderId: number) {
    this.addObjectEvent(parentSite, parentFolder, folderId, "update", true);
    this.addAnalyzerTask(folderId, false);
  }

  /** Called when a site is updated
   * Sideeffects upon commit:
   * - the output analyzer will be triggered for the root folder of the site (recursively)
   */
  siteUpdated(siteId: number) {
    this.addAnalyzerTask(siteId, true);
  }

  /** Called when the site settings have been changed
   * Sideeffects upon commit:
   * - the eventcompletion handler will be triggered to check the site settings
   */
  checkSiteSettings() {
    this._checkSiteSettings = true;
  }

  /** Called to remove a link-checked fs_setting
   * Sideeffects upon commit:
   * - the link checker will remove the setting from the database of checked settings
   */
  removeLinkCheckSettings(settingIds: number[]) {
    settingIds.forEach(id => this._linkCheckRemovedSettings.add(id));
  }

  /** Called to add a link-checked fs_setting
   * Sideeffects upon commit:
   * - the link checker will add the setting to the database of checked settings
   */
  addLinkCheckSettings(settingIds: number[]) {
    settingIds.forEach(id => this._linkCheckSettings.add(id));
  }

  /** Trigger an empty update to an fsObject (for example when only contenttype data has changed)
   * Sideeffects upon commit:
   * - the file object will have the modification date updated
   * - emits a 'update' event for the file or folder, and a system:whfs.site.<siteid> event
   * - a file will be queued for republishing if marked as published
   */
  triggerEmptyUpdateOnCommit(objectId: number) {
    this._emptyUpdates.add(objectId);
  }

  /** Trigger an consilio reindex upon commit
   * Sideeffects upon commit:
   * - the file will be scheduled for reindexing
   */
  triggerReindexOnCommit(objectId: number) {
    this._reindexes.add(objectId);
  }

  /** Adds a completion event to be handled by the completions handler
   * Sideeffects upon commit:
   * - the event will be sent to the eventcompletion handler
  */
  addCompletionEvent(event: WHFSCompletionEvent) {
    // FIXME: determine if this should be merged with objectCreate/objectUpdate
    this._completionEvents.push(event);
  }

  /** Called when the fs types have changed
   * Sideeffects upon commit:
   * - emits a 'system:whfs.types' event
   */
  fsTypesChanged() {
    this._fsTypeChange = true;
  }

  /** Wait for all changes to be indexed
   * Sideeffects upon commit:
   * - the indexing operation will refresh immediately
   * @returns A promise that resolves when the indexing is done, with the ids of updated and deleted objects.
   *   Note that you should commit first before waiting for the promise, otherwise it will never resolve.
   */
  waitForChangesIndexed(): Promise<{ deleted: number[]; updated: number[] }> {
    this._indexPromise ??= Promise.withResolvers();
    void this._indexPromise.promise.catch(() => undefined);
    return this._indexPromise.promise;
  }
}

export const whfsFinishHandler = finishHandlerFactory(WHFSFinishHandler);

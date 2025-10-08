import { HareScriptType, setHareScriptType } from "@webhare/hscompat";
import { emplace } from "@webhare/std";
import { type FinishHandler, broadcastOnCommit } from "@webhare/whdb";
import { finishHandlerFactory } from "@webhare/whdb/src/impl";

/** Events on parentfolder level. Update is triggered by an update to indexDoc */
export type WHFSFolderEventType = "update" | "fullrep";
export type WHFSObjectEventType = "rep" | "create" | "update" | "history" | "rename" | "move" | "moved" | "del" | "unp" | "order";
export type WHFSPublishEventType = "pub";


class WHFSFinishHandler implements FinishHandler {


  private folders = new Map<number, { events?: Array<WHFSFolderEventType>; files: Map<number, { events: Array<WHFSObjectEventType>; isFolder: boolean }>; sites?: Set<number> }>();
  private pubFolders = new Map<number, { files: Map<number, { isFolder: boolean }> }>();

  private toRepublishIds = new Set<number>;
  private toRepublishParents = new Set<number>;

  private addObjectEvent(site: number | null, folder: number | null, object: number, event: WHFSObjectEventType | WHFSPublishEventType, isFolder: boolean) {
    if (event !== "pub") {
      const folderRec = emplace(this.folders, site || 0, { insert: () => ({ files: new Map() }) });
      const events = emplace(folderRec.files, object, { insert: () => ({ events: setHareScriptType([], HareScriptType.StringArray), isFolder }) }).events;
      if (events.indexOf(event) === -1)
        events.push(event);
      if (site)
        (folderRec.sites ??= new Set).add(site);
    } else {
      const folderRec = emplace(this.pubFolders, site || 0, { insert: () => ({ files: new Map() }) });
      emplace(folderRec.files, object, { insert: () => ({ isFolder }) });
    }
  }

  private addFolderEvent(site: number | null, folder: number, event: WHFSFolderEventType) {
    const events = (emplace(this.folders, site || 0, { insert: () => ({ files: new Map() }) }).events ??= setHareScriptType([], HareScriptType.StringArray));
    if (events.indexOf(event) === -1)
      events.push(event);
  }

  onBeforeCommit() {
    const allSites = new Set<number>();
    for (const [folderId, folderRec] of this.folders.entries()) {
      const data = {
        folder: folderId || 0,
        events: setHareScriptType(folderRec.events?.sort() ?? [], HareScriptType.StringArray),
        files: folderRec.files.entries().map(([file, rec]) => ({
          file,
          isfolder: rec.isFolder,
          events: setHareScriptType(rec.events.sort(), HareScriptType.StringArray)
        })).toArray(),
      };
      broadcastOnCommit(`system:whfs.folder.${folderId || 0}`, data);
      if (folderRec.sites) {
        for (const siteId of folderRec.sites)
          allSites.add(siteId);
      }
      if (data.events.includes("fullrep"))
        this.toRepublishParents.add(folderId);
      for (const fileRec of data.files) {
        if (fileRec.events.includes("rep") && fileRec.events.join(",") !== "del,rep")
          this.toRepublishIds.add(fileRec.file);
      }
    }
    for (const [folderId, folderRec] of this.pubFolders.entries()) {
      const data = {
        folder: folderId || 0,
        events: setHareScriptType([], HareScriptType.StringArray),
        files: [...folderRec.files.entries()].map(([file, rec]) => ({ file, events: ["pub"], ...rec })),
      };
      broadcastOnCommit(`publisher:publish.folder.${folderId || 0}`, data);
    }
    for (const siteId of allSites)
      broadcastOnCommit(`system:whfs.site.${siteId}`);
  }

  // ---------------------------------------------------------------------------
  //
  // 'Public' API - (code outside core modules is still not supposed to interact with the commit handler)
  //

  filePublicationFinished(parentSite: number | null, folderId: number | null, fileId: number) {
    this.addObjectEvent(parentSite, folderId, fileId, "pub", false);
  }

  folderRepublish(parentSite: number | null, folderId: number) {
    this.addFolderEvent(parentSite, folderId, "fullrep");
  }

  fileRepublish(parentSite: number | null, folderId: number | null, fileId: number) {
    this.addObjectEvent(parentSite, folderId, fileId, "rep", false);
  }

  objectCreate(parentSite: number | null, folderId: number | null, objectId: number, isFolder: boolean) {
    this.addObjectEvent(parentSite, folderId, objectId, "create", isFolder);
  }

  objectUpdate(parentSite: number | null, folderId: number | null, objectId: number, isFolder: boolean) {
    this.addObjectEvent(parentSite, folderId, objectId, "update", isFolder);
  }

  objectHistoryChange(parentSite: number | null, folderId: number | null, objectId: number, isFolder: boolean) {
    this.addObjectEvent(parentSite, folderId, objectId, "history", isFolder);
  }

  objectRename(parentSite: number | null, folderId: number | null, objectId: number, isFolder: boolean) {
    this.addObjectEvent(parentSite, folderId, objectId, "rename", isFolder);
  }

  objectMove(parentSite: number | null, folderId: number | null, objectId: number, isFolder: boolean) {
    this.addObjectEvent(parentSite, folderId, objectId, "move", isFolder);
  }

  objectMoved(parentSite: number | null, folderId: number | null, objectId: number, isFolder: boolean) {
    this.addObjectEvent(parentSite, folderId, objectId, "moved", isFolder);
  }

  objectDelete(parentSite: number | null, folderId: number | null, objectId: number, isFolder: boolean) {
    this.addObjectEvent(parentSite, folderId, objectId, "del", isFolder);
  }

  fileUnpublish(parentSite: number | null, folderId: number | null, objectId: number) {
    this.addObjectEvent(parentSite, folderId, objectId, "unp", false);
  }

  objectReordered(parentSite: number | null, folderId: number | null, objectId: number, isFolder: boolean) {
    this.addObjectEvent(parentSite, folderId, objectId, "order", isFolder);
  }

}

export const whfsFinishHandler = finishHandlerFactory(WHFSFinishHandler);

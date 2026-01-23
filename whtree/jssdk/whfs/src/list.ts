import type { PlatformDB } from "@mod-platform/generated/db/platform";
import type { FsObjectRow } from "./objects";
import { excludeKeys, isPublish } from "./support";
import { db } from "@webhare/whdb";
import { selectFSFullPath, selectFSHighestParent, selectFSLink, selectFSWHFSPath } from "@webhare/whdb/src/functions";
import { describeWHFSType } from "./describe";
import { isDate } from "@webhare/std";

/// Public version with expected javascript mixed casing
export interface ListableFsObjectRow {
  /// Unique identification for this file
  id: number;
  /// The date and time when this file was created
  created: Temporal.Instant;
  /// The content of the file, for file types which have physical content (all file types except profiles and link files)
  // data: WHDBBlob | null;
  /// A description for this file
  description: string;
  /// Contains additional error information for some publication status codes
  // errorData: string;
  /// If this file is of type 'external link', the URL to which this file points
  // externalLink: string;
  /// If this is an internal or content link file, the id of the linked file
  // fileLink: number | null;
  /// The path from the site's root folder to this file. Always starts and ends with a slash character ('/'), empty if object outside a site
  sitePath: string;
  /// Full path to the file from the root of the WHFS file system - unlike fullpath, this path does not stop at the site root
  whfsPath: string;
  /// The id of the hightest parent that is still in the same site. Equivalent to the 'root' field of the folder's parentsite. 0 if this folder is not inside a site.
  parentSite: number | null;
  /** This is the id of the index document of the folder.
                If a file is selected or a folder has no indexdoc, the indexdoc is 0 else the indexdoc is the id of the file.
  */
  indexDoc: number | null;
  /// The indexurl, is the url of the currently selected document.
  link: string | null;
  /// Whether the selected item is a folder
  isFolder: boolean;
  /// A list of keywords for this file (no specific format for this column is imposed by the WebHare Publisher itself)
  keywords: string;
  /// The date and time  when this file was first published
  firstPublish: Temporal.Instant | null;
  /// The date and time  when this file was last published
  // lastPublishDate: Temporal.Instant;
  /// The size of the item since its last publication
  // lastPublishSize: number;
  /// The time in milliseconds it took to publish the file, last time we succesfully published it. 0 if no measurement is available.
  // lastPublishTime: number;
  /// File scanned data, used to reconstruct a scannedblob record and save some tweakable metadata (such as dominantcolor)
  // scanData: string;
  /// The id of the user that modified this item last.
  // modifiedBy: number | null;
  /// The date and time when any file (meta)data was last modified
  modified: Temporal.Instant;
  /// The date and time when this file's content was last modified
  contentModified: Temporal.Instant | null;
  /// The name for this file, which must be unique inside its parent folder
  name: string;
  /// Relative ordering of this file
  ordering: number;
  /// Id of the folder containing this file
  parent: number | null;
  /// Checks if the document needs to be published or not
  publish: boolean;
  /// Status en flags indicating the current publishing, task and error status of the file.
  // published: number;
  /// The title of the currently selected item
  title: string;
  /// The file's type. See the file type list for more information on the currently supported file ids.
  type: string;
  /// The URL to (the first page of) the published file. An empty string if this file will not be published.
  // url: string;
  /// Checks if the current selected item is active
  // isActive: boolean;
  /// If pinned the item cannot be replaced/renamed or deleted.
  isPinned: boolean;
  /// If unlisted the item should be hidden from menus and other navigation.
  isUnlisted: boolean;
}

const fsObjects_js_to_db: Record<keyof ListableFsObjectRow, keyof FsObjectRow> = {
  "created": "creationdate",
  "contentModified": "contentmodificationdate",
  "description": "description",
  "firstPublish": "firstpublishdate",
  "sitePath": "fullpath",
  "whfsPath": "whfspath",
  "parentSite": "parentsite",
  "indexDoc": "indexdoc",
  "link": "link",
  "id": "id",
  "isFolder": "isfolder",
  "keywords": "keywords",
  "modified": "modificationdate",
  "name": "name",
  "ordering": "ordering",
  "parent": "parent",
  "publish": "publish",
  "title": "title",
  "type": "type",
  "isPinned": "ispinned",
  "isUnlisted": "isunlisted"
};

// const fsObjects_db_to_js: Partial<Record<keyof FsObjectRow, keyof ListableFsObjectRow>> = Object.fromEntries(Object.entries(fsObjects_js_to_db).map(([k, v]) => [v, k]));

export async function list<K extends keyof ListableFsObjectRow = never>(start: number, keys?: K[]): Promise<Array<Pick<ListableFsObjectRow, K | "id" | "name" | "isFolder">>> {
  const getkeys = new Set<keyof ListableFsObjectRow>(["id", "name", "isFolder", ...(keys || [])]);
  const selectkeys = new Set<keyof FsObjectRow>;

  for (const k of getkeys) {
    const dbkey = fsObjects_js_to_db[k];
    if (!dbkey)
      throw new Error(`No such listable property '${k}'`); //TODO didyoumean
    selectkeys.add(dbkey);
  }

  const retval = await db<PlatformDB>()
    .selectFrom("system.fs_objects")
    .where(qb => start ? qb.eb("parent", "=", start) : qb.eb("parent", "is", null))
    .select(excludeKeys([...selectkeys], ["link", "fullpath", "whfspath", "parentsite", "publish"]))
    .$if(getkeys.has("link"), qb => qb.select(selectFSLink().as("link")))
    .$if(getkeys.has("sitePath"), qb => qb.select(selectFSFullPath().as("fullpath")))
    .$if(getkeys.has("whfsPath"), qb => qb.select(selectFSWHFSPath().as("whfspath")))
    .$if(getkeys.has("parentSite"), qb => qb.select(selectFSHighestParent().as("parentsite")))
    .$if(getkeys.has("publish"), qb => qb.select("published"))
    .execute();

  const mappedrows = [];
  for (const row of retval) {
    const result: Pick<ListableFsObjectRow, K | "id" | "name" | "isFolder" | "type"> = {} as Pick<ListableFsObjectRow, K | "id" | "name" | "isFolder" | "type">;
    for (const k of getkeys) {
      if (k === 'type') { //remap to string
        const type = await describeWHFSType(row.type || 0, { allowMissing: true, metaType: row.isfolder ? "folderType" : "fileType" });
        result.type = type?.scopedType || type?.namespace || "#" + row.type;
      } else if (k === 'publish') { //remap from published
        (result as unknown as { publish: boolean }).publish = isPublish(row.published);
      } else {
        const dbkey: keyof typeof row = fsObjects_js_to_db[k] as keyof typeof row;
        if (dbkey in row) {
          const curvalue = row[dbkey];
          if (isDate(curvalue))
            ///@ts-expect-error Too complex for typescript to figure out apparently. We'll rely on our test coverage
            result[k] = Temporal.Instant.fromEpochMilliseconds(curvalue);
          else
            ///@ts-expect-error Too complex for typescript to figure out apparently. We'll rely on our test coverage
            result[k] = row[dbkey];
        }
      }
    }
    mappedrows.push(result);
  }

  return mappedrows;
}

import { getTid } from "@webhare/gettid";
import type { SpreadsheetColumn, SpreadsheetData } from "@webhare/office-formats";
import { listWHFSObjects, openFolder, whfsType } from "@webhare/whfs";
import type { ReportContext } from "@webhare/backend-integration";

/* Note: row keys are kept lowercase without word separators so they survive the camelcase conversion
   when this report is returned to HareScript (column names are values and are not converted) */

/** Apply inherited robot settings. Rows must be ordered by fullpath */
function applyInheritance<Row extends { fullpath: string; isfolder: boolean }>(rows: Row[], forField: keyof Row & ("noindex" | "nofollow" | "noarchive"), langCode: string) {
  let inheritance = "", inheritanceFrom = "";
  for (const row of rows) {
    if (inheritanceFrom && row.fullpath.startsWith(inheritanceFrom)) { //this is 'deeper' and inside the inheriting tree
      (row[forField] as string) = inheritance;
      continue;
    }

    inheritanceFrom = "";
    if (row.isfolder && row[forField]) { //non empty = set
      //All rows whose path is deeper than ours will be overwritten
      inheritanceFrom = row.fullpath;
      inheritance = getTid("publisher:tolliumapps.filemanager.seoreport.isinheritedfrom", [row.fullpath], { langCode });
    }
  }
}

/** onGenerate for the platform:seosettings report */
export async function getSEOReport(params: { folder: number }, settings: object, context: ReportContext): Promise<SpreadsheetData> {
  const startingFolderId = params.folder;
  const { langCode } = context;
  const startingFolder = await openFolder(startingFolderId);
  const fileFolderTypeFile = getTid("publisher:common.publisherfields.filefoldertype-file", { langCode });
  const fileFolderTypeFolder = getTid("publisher:common.publisherfields.filefoldertype-folder", { langCode });

  const listKeys = ["title", "description", "sitePath", "link", "objectBaseURL", "publish"] as const;
  const objects = [
    ...await listWHFSObjects([...listKeys], { ids: [startingFolderId] }),
    ...await startingFolder.listRecursive([...listKeys])
  ];

  const baseRows = objects
    .filter(obj => obj.isFolder || obj.publish)
    .map(obj => ({
      id: obj.id,
      fullpath: obj.sitePath,
      title: obj.title,
      description: obj.isFolder ? "" : obj.description,
      link: obj.isFolder ? obj.objectBaseURL : obj.link || "", //for folders, make sure we don't show a redirecting url
      filefoldertype: obj.isFolder ? fileFolderTypeFolder : fileFolderTypeFile,
      isfolder: obj.isFolder
    }))
    .sort((lhs, rhs) => lhs.fullpath < rhs.fullpath ? -1 : lhs.fullpath > rhs.fullpath ? 1 : 0);

  const withConfig = await whfsType("platform:web.config").enrich(baseRows, "id", ["noIndex", "noFollow", "noArchive", "customRobots", "canonical", "comments"]);
  const withMetadata = await whfsType("platform:web.metadata").enrich(withConfig, "id", ["seoTitle", "pageHeading"]);
  const withWords = await whfsType("platform:consilio.boostwords").enrich(withMetadata, "id", ["words"]);

  const robotPropIsSet = getTid("publisher:tolliumapps.filemanager.seoreport.isset", { langCode });
  const rows = withWords.map(row => ({
    id: row.id,
    fullpath: row.fullpath,
    link: row.link,
    filefoldertype: row.filefoldertype,
    title: row.title,
    seotitle: row.seoTitle || "",
    pageheading: row.pageHeading || "",
    noindex: row.noIndex ? robotPropIsSet : "",
    nofollow: row.noFollow ? robotPropIsSet : "",
    noarchive: row.noArchive ? robotPropIsSet : "",
    canonicalid: row.canonical && row.canonical !== row.id ? row.canonical : 0,
    canonical: "",
    customrobots: row.customRobots || "",
    comments: row.comments || "",
    words: [...new Set(row.words || [])].sort().join("; "),
    isfolder: row.isfolder
  }));

  //Apply inherited noindex/nofollow/noarchive
  applyInheritance(rows, "noindex", langCode);
  applyInheritance(rows, "nofollow", langCode);
  applyInheritance(rows, "noarchive", langCode);

  //Resolve canonical URLs
  const lookupCanonicals = [...new Set(rows.map(row => row.canonicalid).filter(id => id))];
  if (lookupCanonicals.length) {
    const canonicalUrls = new Map((await listWHFSObjects(["objectBaseURL"], { ids: lookupCanonicals })).map(obj => [obj.id, obj.objectBaseURL]));

    for (const row of rows)
      if (row.canonicalid)
        row.canonical = canonicalUrls.get(row.canonicalid) || "";
  }

  const columns: SpreadsheetColumn[] = [
    { name: "id", type: "number", title: getTid("publisher:common.publisherfields.whfsid", { langCode }) },
    { name: "fullpath", type: "string", title: getTid("publisher:common.publisherfields.fullpath", { langCode }) },
    { name: "link", type: "string", title: getTid("~url", { langCode }) },
    { name: "filefoldertype", type: "string", title: getTid("publisher:common.publisherfields.filefoldertype", { langCode }) },
    { name: "title", type: "string", title: getTid("publisher:common.seosettings.navigationtitle", { langCode }) },
    { name: "seotitle", type: "string", title: getTid("platform:siteprofiles.types.web.metadata.seo_title", { langCode }) },
    { name: "pageheading", type: "string", title: getTid("platform:siteprofiles.types.web.metadata.page_heading", { langCode }) },
    { name: "noindex", type: "string", title: "noindex" },
    { name: "nofollow", type: "string", title: "nofollow" },
    { name: "noarchive", type: "string", title: "noarchive" },
    { name: "canonical", type: "string", title: getTid("publisher:common.seosettings.canonical", { langCode }) },
    { name: "customrobots", type: "string", title: getTid("publisher:common.seosettings.customrobots", { langCode }) },
    { name: "comments", type: "string", title: getTid("~comments", { langCode }) },
    { name: "words", type: "string", title: getTid("consilio:objectprops.boostwords.words", { langCode }) }
  ];

  const name = startingFolder.id === startingFolder.parentSite ? startingFolder.name : startingFolder.sitePath || "";
  return {
    rows: rows.map(({ isfolder, canonicalid, ...row }) => row),
    columns,
    title: getTid("publisher:tolliumapps.filemanager.seoreport.exporttitle", [name], { langCode })
  };
}

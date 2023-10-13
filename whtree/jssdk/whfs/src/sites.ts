import { db, sql, Selectable } from "@webhare/whdb";
import type { PlatformDB } from "@mod-system/js/internal/generated/whdb/platform";
import { WHFSFile, WHFSFolder, openWHFSObject } from "./objects";
import { excludeKeys, formatPathOrId } from "./support";

// Adds the custom generated columns
interface SiteRow extends Selectable<PlatformDB, "system.sites"> {
  webroot: string;
}

/// Public version with expected javascript mixed casing
interface ListableSiteRow {
  id: number;
  /// A short description of the contents of the site
  description: string;
  /// True if this site is locked (it may not be browsed or modified by its owners, and the site published output will not be modified)
  locked: boolean;
  /// The reason specified by the user locking this site
  lockReason: string;
  /// The name for this site, as displayed in the site overview
  name: string;
  /// The subfolder in which the site should be published inside the specified webserver. This folder's name always ends in a slash
  outputFolder: string;
  /// The webserver on which this site is hosted, null if the site is not published
  outputWeb: number | null;
  /// The corresponding CDN URL for the webroot
  cdnBaseURL: string;
  /// The full base URL on which this site will be published, calculated by combining and encoding the webserver's base URL and the site's output folder. Empty if this site is not published
  webRoot: string;
  /// Whether the site is under version control
  versioningPolicy: string;
}

const sites_js_to_db: Record<keyof ListableSiteRow, keyof SiteRow> = {
  "cdnBaseURL": "cdnbaseurl",
  "description": "description",
  "id": "id",
  "locked": "locked",
  "lockReason": "lockreason",
  "name": "name",
  "outputFolder": "outputfolder",
  "outputWeb": "outputweb",
  "versioningPolicy": "versioningpolicy",
  "webRoot": "webroot"
};

export class Site {
  private readonly dbrow: SiteRow;

  get id() { return this.dbrow.id; }
  get name() { return this.dbrow.name; }
  get webRoot() { return this.dbrow.webroot; }

  constructor(siterecord: SiteRow) {
    this.dbrow = siterecord;
  }

  async openFile(path: string, options: { allowMissing: true }): Promise<WHFSFile | null>;
  async openFile(path: string, options?: { allowMissing: boolean }): Promise<WHFSFile>;
  async openFile(path: string, options?: { allowMissing: boolean }) {
    return openWHFSObject(this.id, path, true, options?.allowMissing ?? false, `in site '${this.name}'`);
  }

  async openFolder(path: string, options: { allowMissing: true }): Promise<WHFSFolder | null>;
  async openFolder(path: string, options?: { allowMissing: boolean }): Promise<WHFSFolder>;
  async openFolder(path: string, options?: { allowMissing: boolean }) {
    return openWHFSObject(this.id, path, false, options?.allowMissing ?? false, `in site '${this.name}'`);
  }
}


export async function openSite(site: number | string, options: { allowMissing: true }): Promise<Site | null>;
export async function openSite(site: number | string, options?: { allowMissing: boolean }): Promise<Site>;

export async function openSite(site: number | string, options?: { allowMissing: boolean }) {
  //TODO we may need a view for this ? or learn our sql about .append too or similar
  const match = await db<PlatformDB>()
    .selectFrom("system.sites")
    .selectAll()
    .select(sql<string>`webhare_proc_sites_webroot(outputweb, outputfolder)`.as("webroot"))
    .$call(qb => {
      if (typeof site === "number")
        return qb.where("id", "=", site);
      else
        return qb.where(sql`upper(name)`, "=", sql`upper(${site})`);
    })
    .executeTakeFirst();

  if (!match)
    if (options?.allowMissing)
      return null;
    else
      throw new Error(`No such site ${formatPathOrId(site)}`);

  return new Site(match);
}

/** List all WebHare sites */
export async function listSites<K extends keyof ListableSiteRow>(keys: K[] = []): Promise<Array<Pick<ListableSiteRow, K | "id" | "name">>> {
  const getkeys = new Set<keyof ListableSiteRow>(["id", "name", ...keys]);
  const selectkeys = new Set<keyof SiteRow>;

  for (const k of getkeys) {
    const dbkey = sites_js_to_db[k];
    if (!dbkey)
      throw new Error(`No such listable property '${k}'`); //TODO didyoumean
    selectkeys.add(dbkey);
  }

  const rows = await db<PlatformDB>()
    .selectFrom("system.sites")
    .select(excludeKeys([...selectkeys], ["webroot"]))
    .$if(selectkeys.has("webroot"), qb => qb.select(sql<string>`webhare_proc_sites_webroot(outputweb, outputfolder)`.as("webroot")))
    .execute();

  const mappedrows = rows.map(row => {

    const result: Pick<ListableSiteRow, K | "id" | "name"> = {} as Pick<ListableSiteRow, K | "id" | "name">;
    for (const k of getkeys) {
      const dbkey = sites_js_to_db[k];
      if (dbkey in row)
        ///@ts-ignore Too complex for typescript to figure out apparently. We'll write a manual test..
        result[k] = row[dbkey];
    }
    return result;
  });

  return mappedrows;
}

import { db, sql, type Selectable } from "@webhare/whdb";
import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { type WHFSFile, type WHFSFolder, __openWHFSObj, type OpenWHFSObjectOptions } from "./objects";
import { excludeKeys, formatPathOrId } from "./support";
import { openType, whfsType, type WHFSTypeGetResult } from "./contenttypes";
import { createAppliedPromise } from "@webhare/services/src/applyconfig.ts";
import { selectSitesWebRoot } from "@webhare/whdb/src/functions";

// Adds the custom generated columns
export interface SiteRow extends Selectable<PlatformDB, "system.sites"> {
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
  /// Webdesign applied to a site
  webDesign: string;
  /// Activated webfeatures
  webFeatures: string[] | null;
}

type UpdateableSiteSettings = Pick<ListableSiteRow, "webDesign" | "webFeatures">;

const sites_js_to_db: Record<keyof Omit<ListableSiteRow, "webDesign" | "webFeatures">, keyof SiteRow> = {
  "cdnBaseURL": "cdnbaseurl",
  "description": "description",
  "id": "id",
  "locked": "locked",
  "lockReason": "lockreason",
  "name": "name",
  "outputFolder": "outputfolder",
  "outputWeb": "outputweb",
  "webRoot": "webroot"
};

export class Site {
  private readonly dbrow: SiteRow;

  /** Site primary key (matches root folder id) */
  get id(): number {
    return this.dbrow.id;
  }

  /** Site name */
  get name(): string {
    return this.dbrow.name;
  }

  /** Absolute URL where the site is published, or null if the site is not published */
  get webRoot(): string | null {
    return this.dbrow.webroot || null;
  }

  /** ID of the webserver to which the site is published, null if unpublished*/
  get outputWeb(): number | null {
    return this.dbrow.outputweb;
  }

  /** Folder inside the webserver where the site is published */
  get outputFolder(): string {
    return this.dbrow.outputfolder;
  }

  constructor(siterecord: SiteRow) {
    this.dbrow = siterecord;
  }

  async openFile(path: string, options: OpenWHFSObjectOptions & { allowMissing: true }): Promise<WHFSFile | null>;
  async openFile(path: string, options?: OpenWHFSObjectOptions): Promise<WHFSFile>;
  async openFile(path: string, options?: OpenWHFSObjectOptions) {
    return __openWHFSObj(this.id, path, true, options?.allowMissing ?? false, `in site '${this.name}'`, options?.allowHistoric ?? false, false);
  }

  async openFolder(path: string, options: OpenWHFSObjectOptions & { allowMissing: true }): Promise<WHFSFolder | null>;
  async openFolder(path: string, options?: OpenWHFSObjectOptions): Promise<WHFSFolder>;
  async openFolder(path: string, options?: OpenWHFSObjectOptions) {
    return __openWHFSObj(this.id, path, false, options?.allowMissing ?? false, `in site '${this.name}'`, options?.allowHistoric ?? false, false);
  }

  /** Get the webdesign for this site */
  async getWebDesign(): Promise<string> {
    return (await openType("http://www.webhare.net/xmlns/publisher/sitesettings").get(this.id)).sitedesign as string;
  }

  /** Get enabled webfeatures for this site */
  async getWebFeatures(): Promise<string[] | null> {
    const features = (await openType("http://www.webhare.net/xmlns/publisher/sitesettings").get(this.id)).webfeatures as string[];
    return features.length ? features.sort() : null;
  }

  /** Update site settings */
  async update(updates: UpdateableSiteSettings): Promise<{ applied: () => Promise<void> }> {
    let metadataupdate: Record<string, unknown> | undefined;
    if ("webDesign" in updates)
      metadataupdate = { ...metadataupdate, sitedesign: updates.webDesign };
    if ("webFeatures" in updates)
      metadataupdate = { ...metadataupdate, webfeatures: updates.webFeatures?.length ? updates.webFeatures.sort() : [] };
    if (metadataupdate)
      await openType("http://www.webhare.net/xmlns/publisher/sitesettings").set(this.id, metadataupdate);

    return { applied: createAppliedPromise({ subsystems: ["siteprofilerefs"], source: "site.update" }) };
  }
}


export async function openSite(site: number | string, options: { allowMissing: true }): Promise<Site | null>;
export async function openSite(site: number | string, options?: { allowMissing: boolean }): Promise<Site>;

export async function openSite(site: number | string, options?: { allowMissing: boolean }) {
  //TODO we may need a view for this ? or learn our sql about .append too or similar
  const match = await db<PlatformDB>()
    .selectFrom("system.sites")
    .selectAll()
    .select(selectSitesWebRoot().as("webroot"))
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
export async function listSites<K extends keyof ListableSiteRow = never>(keys: K[] = []): Promise<Array<Pick<ListableSiteRow, K | "id" | "name">>> {
  const getkeys = new Set<keyof ListableSiteRow>(["id", "name", ...keys]);
  const selectkeys = new Set<keyof SiteRow>;
  const getSiteProps: Array<keyof WHFSTypeGetResult<"platform:publisher.sitesettings">> = [];

  for (const k of getkeys) {
    switch (k) {
      case "webDesign":
        getSiteProps.push("sitedesign");
        break;
      case "webFeatures":
        getSiteProps.push("webfeatures");
        break;
      default: {
        const dbkey = sites_js_to_db[k];
        if (!dbkey)
          throw new Error(`No such listable property '${k}'`); //TODO didyoumean
        selectkeys.add(dbkey);
      }
    }
  }

  let rows = await db<PlatformDB>()
    .selectFrom("system.sites")
    .select(excludeKeys([...selectkeys], ["webroot"]))
    .$if(selectkeys.has("webroot"), qb => qb.select(selectSitesWebRoot().as("webroot")))
    .execute();

  if (getSiteProps.length) {
    rows = await whfsType("http://www.webhare.net/xmlns/publisher/sitesettings").enrich(rows, "id", getSiteProps);
  }

  const mappedrows = rows.map(row => {
    const result: Pick<ListableSiteRow, K | "id" | "name"> = {} as Pick<ListableSiteRow, K | "id" | "name">;
    for (const k of getkeys) {
      switch (k) {
        case "webDesign":
          ///@ts-ignore Too complex for typescript to figure out apparently. We'll write a manual test..
          result.webDesign = row.sitedesign;
          break;
        case "webFeatures":
          ///@ts-ignore Too complex for typescript to figure out apparently. We'll write a manual test..
          result.webFeatures = row.webfeatures.length ? row.webfeatures.sort() : null;
          break;
        default: {
          const dbkey = sites_js_to_db[k];
          if (dbkey in row)
            ///@ts-ignore Too complex for typescript to figure out apparently. We'll write a manual test..
            result[k] = row[dbkey];
        }
      }
    }
    return result;
  });

  return mappedrows;
}

import { broadcastOnCommit, db, isWorkOpen, sql, type Selectable, type Updateable } from "@webhare/whdb";
import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { loadlib } from "@webhare/harescript";
import { type WHFSFile, type WHFSFolder, __openWHFSObj, openFolder, type OpenWHFSObjectOptions } from "./objects";
import { excludeKeys, formatPathOrId } from "./support";
import { whfsFinishHandler } from "./finishhandler";
import { whfsType, type TypedInstanceData } from "./contenttypes";
import { selectFSWHFSPath, selectSitesWebRoot } from "@webhare/whdb/src/functions";
import { ListingContext, listRecursive, type ListableFsObjectRow, type ListFSOptions, type ListFSRecursiveOptions, type WHFSRecursiveListResult, type WHFSListResult } from "./list";

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
  cdnBaseURL: string | null;
  /// The full base URL on which this site will be published, calculated by combining and encoding the webserver's base URL and the site's output folder. Empty if this site is not published
  webRoot: string;
  /// Webdesign applied to a site
  webDesign: string;
  /// Activated webfeatures
  webFeatures: string[] | null;
}

type UpdateableSiteSettings = Pick<ListableSiteRow, "cdnBaseURL" | "webDesign" | "webFeatures" | "name" | "description" | "locked" | "lockReason">;

export type CreateSiteOptions = {
  /** Name for the site. The site's root folder is renamed to match. Defaults to the name of the folder */
  name?: string;
  /** A short description of the contents of the site. Defaults to the description of the folder */
  description?: string;
  /** Webdesign to apply to the site */
  webDesign?: string;
  /** Webfeatures to activate */
  webFeatures?: string[];
  /** Whether the site is locked */
  locked?: boolean;
  /** The reason the site is locked */
  lockReason?: string;
};

async function getSiteName(id: number): Promise<string> {
  return (await db<PlatformDB>().selectFrom("system.sites").select("name").where("id", "=", id).executeTakeFirst())?.name ?? `#${id}`;
}

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
  private dbrow: SiteRow;

  /** Site primary key (matches root folder id) */
  get id(): number {
    return this.dbrow.id;
  }

  /** Site name */
  get name(): string {
    return this.dbrow.name;
  }

  /** A short description of the contents of the site */
  get description(): string {
    return this.dbrow.description;
  }

  /** Whether the site is locked */
  get locked(): boolean {
    return this.dbrow.locked;
  }

  /** The reason the site is locked */
  get lockReason(): string {
    return this.dbrow.lockreason;
  }

  /** Absolute URL where the site is published, or null if the site is not published */
  get webRoot(): string | null {
    return this.dbrow.webroot || null;
  }

  /** Get URL for the CDN, if any */
  get cdnBaseURL(): string | null {
    return this.dbrow.cdnbaseurl || null;
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

  list<K extends keyof ListableFsObjectRow = never>(keys?: K[], options?: ListFSOptions): Promise<Array<WHFSListResult<K>>> {
    const ctx = new ListingContext(keys, options);
    return ctx.list([this.id]);
  }

  listRecursive<K extends keyof ListableFsObjectRow = never>(keys?: K[], options?: ListFSRecursiveOptions): Promise<Array<WHFSRecursiveListResult<K>>> {
    return listRecursive(this.id, keys, options);
  }

  /** Get the webdesign for this site */
  async getWebDesign(): Promise<string> {
    return (await whfsType("platform:web.sitesettings").get(this.id)).sitedesign as string;
  }

  /** Get enabled webfeatures for this site */
  async getWebFeatures(): Promise<string[] | null> {
    const features = (await whfsType("platform:web.sitesettings").get(this.id)).webfeatures as string[];
    return features.length ? features.sort() : null;
  }

  private async reload() {
    const reload = await loadSite(this.id);
    if (!reload)
      throw new Error(`Site '${this.name}' (#${this.id}) disappeared after update`);

    this.dbrow = reload;
  }

  /** Schedule what needs to happen after the site's settings changed
   * @param republish - Republish the whole site and analyze its output */
  private async finishUpdate(republish: boolean) {
    if (republish)
      await loadlib("mod::publisher/lib/control.whlib").ScheduleFolderRepublish(this.id, /*recursive=*/true, /*non_templates_too=*/true);

    whfsFinishHandler().siteUpdated(this.id, { analyzeOutput: republish });
    broadcastOnCommit(`system:whfs.sitemeta.${this.id}`);
  }

  /** Update site settings
   * @param updates - Settings to change. Changing `name` renames the site's root folder */
  async update(updates: Partial<UpdateableSiteSettings>) {
    let republish = false;

    let changed = false;
    if (updates.name !== undefined && updates.name !== this.name) {
      await (await openFolder(this.id)).update({ name: updates.name }); //this updates the name in system.sites too
      changed = true;
    }

    let metadataupdate: Record<string, unknown> | undefined;
    if ("webDesign" in updates && updates.webDesign !== await this.getWebDesign()) {
      metadataupdate = { ...metadataupdate, sitedesign: updates.webDesign };
      republish = true;
    }
    if ("webFeatures" in updates) {
      const webFeatures = updates.webFeatures?.length ? [...new Set(updates.webFeatures)].sort() : [];
      if (JSON.stringify(webFeatures) !== JSON.stringify(await this.getWebFeatures() ?? [])) {
        metadataupdate = { ...metadataupdate, webfeatures: webFeatures };
        republish = true;
      }
    }
    if (metadataupdate)
      await whfsType("platform:web.sitesettings").set(this.id, metadataupdate);

    const dbupdates: Updateable<PlatformDB, "system.sites"> = {};
    if (updates.cdnBaseURL !== undefined) {
      if (updates.cdnBaseURL !== null && !updates.cdnBaseURL.endsWith("/"))
        throw new Error(`CDN root must end with a slash ('/')`);

      dbupdates.cdnbaseurl = updates.cdnBaseURL || "";
    }
    if (updates.description !== undefined)
      dbupdates.description = updates.description;
    if (updates.lockReason !== undefined)
      dbupdates.lockreason = updates.lockReason;
    if (updates.locked !== undefined && updates.locked !== this.locked) {
      dbupdates.locked = updates.locked;
      republish = true; //locked sites aren't published
    }

    if (Object.keys(dbupdates).length) {
      await db<PlatformDB>().updateTable("system.sites").set(dbupdates).where("id", "=", this.id).execute();
    }

    if (!changed && !metadataupdate && !Object.keys(dbupdates).length)
      return;

    await this.finishUpdate(republish);
    await this.reload();
  }
}

async function loadSite(site: number | string): Promise<SiteRow | null> {
  return await db<PlatformDB>()
    .selectFrom("system.sites")
    .selectAll()
    .select(selectSitesWebRoot().as("webroot"))
    .$call(qb => {
      if (typeof site === "number")
        return qb.where("id", "=", site);
      else
        return qb.where(sql`upper(name)`, "=", sql`upper(${site})`);
    })
    .executeTakeFirst() || null;
}

export async function openSite(site: number | string, options: { allowMissing: true }): Promise<Site | null>;
export async function openSite(site: number | string, options?: { allowMissing: boolean }): Promise<Site>;

export async function openSite(site: number | string, options?: { allowMissing: boolean }) {
  const match = await loadSite(site);

  if (!match)
    if (options?.allowMissing)
      return null;
    else
      throw new Error(`No such site ${formatPathOrId(site)}`);

  return new Site(match);
}

/** Turn a folder into a site
 * @param rootId - Id of the folder that becomes the site's root. It may not be part of a site yet
 * @param options - Initial settings for the site
 * @returns The new site. It isn't published until you set its output with `setOutput` */
export async function createSite(rootId: number, options?: CreateSiteOptions): Promise<Site> {
  if (!isWorkOpen())
    throw new Error(`createSite requires open work`);
  if (!rootId)
    throw new Error(`The WHFS root folder cannot be turned into a site`);

  const root = await openFolder(rootId); //we take an id and open the folder ourselves, so we never work with stale data
  if (root.parentSite)
    throw new Error(`Folder '${root.whfsPath}' is already part of site '${await getSiteName(root.parentSite)}'`);

  const sitePaths = await db<PlatformDB>()
    .selectFrom("system.fs_objects")
    .select(selectFSWHFSPath().as("whfspath"))
    .where("id", "in", db<PlatformDB>().selectFrom("system.sites").select("id"))
    .execute();
  const containedSite = sitePaths.find(site => site.whfspath.toUpperCase().startsWith(root.whfsPath.toUpperCase()));
  if (containedSite)
    throw new Error(`Folder '${root.whfsPath}' cannot be turned into a site, it already contains the site at '${containedSite.whfspath}'`);

  if (options?.name !== undefined && options.name !== root.name)
    await root.update({ name: options.name });

  await db<PlatformDB>().insertInto("system.sites").values({
    id: root.id,
    name: root.name,
    description: options?.description ?? root.description ?? "",
    locked: options?.locked ?? false,
    lockreason: options?.lockReason ?? "",
    outputweb: null,
    outputfolder: "",
    cdnbaseurl: ""
  }).execute();

  const finishHandler = whfsFinishHandler();
  finishHandler.checkSiteSettings();
  finishHandler.objectUpdate(root.id, root.parent, root.id, true);
  finishHandler.siteUpdated(root.id, { analyzeOutput: true, siteProfileRefs: true });
  broadcastOnCommit("system:sites", { siteid: root.id });

  const site = await openSite(root.id);
  if (options?.webDesign !== undefined || options?.webFeatures !== undefined)
    await site.update({
      ...options.webDesign !== undefined ? { webDesign: options.webDesign } : {},
      ...options.webFeatures !== undefined ? { webFeatures: options.webFeatures } : {}
    });
  return site;
}

/** List all WebHare sites */
export async function listSites<K extends keyof ListableSiteRow = never>(keys: K[] = []): Promise<Array<Pick<ListableSiteRow, K | "id" | "name">>> {
  const getkeys = new Set<keyof ListableSiteRow>(["id", "name", ...keys]);
  const selectkeys = new Set<keyof SiteRow>;
  const getSiteProps: Array<keyof TypedInstanceData<"platform:web.sitesettings">> = [];

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
    rows = await whfsType("platform:web.sitesettings").enrich(rows, "id", getSiteProps);
  }

  const mappedrows = rows.map(row => {
    const result: Pick<ListableSiteRow, K | "id" | "name"> = {} as Pick<ListableSiteRow, K | "id" | "name">;
    for (const k of getkeys) {
      switch (k) {
        case "webDesign":
          ///@ts-expect-error Too complex for typescript to figure out apparently. We'll write a manual test..
          result.webDesign = row.sitedesign;
          break;
        case "webFeatures":
          ///@ts-expect-error Too complex for typescript to figure out apparently. We'll write a manual test..
          result.webFeatures = row.webfeatures.length ? row.webfeatures.sort() : null;
          break;
        default: {
          const dbkey = sites_js_to_db[k];
          if (dbkey in row)
            ///@ts-expect-error Too complex for typescript to figure out apparently. We'll write a manual test..
            result[k] = row[dbkey];
        }
      }
    }
    return result;
  });

  return mappedrows;
}

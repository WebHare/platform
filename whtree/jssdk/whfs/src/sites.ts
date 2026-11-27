import { broadcastOnCommit, db, isWorkOpen, sql, type Selectable, type Updateable } from "@webhare/whdb";
import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { loadlib } from "@webhare/harescript";
import { whconstant_webservertype_interface, whconstant_whfsid_webharebackend, whconstant_whfstype_foreignfolder } from "@mod-system/js/internal/webhareconstants";
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

/** Where to publish a site:
 * - `webServer` and `folder`: in a folder on a webserver
 * - `site` and `folder`: in a foreign folder inside another site. The folder is created if needed
 */
export type SiteOutput = {
  /** Id of the webserver that hosts the site */
  webServer: number;
  /** Folder inside the webserver, eg. `/` or `/subsite/` */
  folder: string;
} | {
  /** Site to publish into. It must have an output itself */
  site: Site;
  /** Path of the foreign folder inside that site, eg. `testoutput/mysite`. Missing parent folders are created as normal folders */
  folder: string;
};

const foreignFolderType = "platform:foldertypes.extern";
const normalFolderType = "platform:foldertypes.default";

/** Normalize an output folder to an absolute path that starts and ends with a slash */
function normalizeOutputFolder(folder: string): string {
  const parts: string[] = [];
  for (const part of folder.split("/")) {
    if (part === "..")
      parts.pop();
    else if (part && part !== ".")
      parts.push(part);
  }
  return parts.length ? `/${parts.join("/")}/` : "/";
}

type NeededForeignFolder = {
  /** Site that has to contain the foreign folder */
  inSite: number;
  /** Path of the foreign folder inside that site */
  path: string;
  /** Site that is published at the location of the foreign folder */
  forSite: number;
};

/** Check whether a site that publishes `subPath` (relative to its own output) has a foreign folder covering it
 * @returns True if any folder along the path is a foreign folder */
async function hasForeignFolderAt(siteId: number, subPath: string): Promise<boolean> {
  let current: number = siteId;
  for (const name of subPath.split("/").filter(Boolean)) {
    const child = await db<PlatformDB>()
      .selectFrom("system.fs_objects")
      .select(["id", "isfolder", "type"])
      .where("parent", "=", current)
      .where(sql`upper(name)`, "=", sql`upper(${name})`)
      .executeTakeFirst();

    if (!child || !child.isfolder)
      return false;
    if (child.type === whconstant_whfstype_foreignfolder)
      return true;
    current = child.id;
  }
  return false;
}

/** Test whether a site can be published at a location
 * @param forSite - The site we're testing for
 * @param webServer - Id of the webserver
 * @param folder - Normalized output folder
 * @param options - containedOnly: only check the sites we would contain, not the site that would contain us
 * @returns The first problem found, or null if the location is available */
async function findOutputConflict(forSite: number, webServer: number, folder: string, options?: { containedOnly?: boolean }): Promise<{ siteOnLocation: number } | { neededFolder: NeededForeignFolder } | null> {
  const others = await db<PlatformDB>()
    .selectFrom("system.sites")
    .select(["id", "outputfolder"])
    .where("outputweb", "=", webServer)
    .where("id", "!=", forSite)
    .execute();

  const upperFolder = folder.toUpperCase();

  //Find the site that contains this folder. It needs a foreign folder at our location
  const containing = options?.containedOnly ? undefined : others.filter(site => upperFolder.startsWith(site.outputfolder.toUpperCase())).sort((lhs, rhs) => rhs.outputfolder.length - lhs.outputfolder.length)[0];
  if (containing) {
    const subPath = folder.substring(containing.outputfolder.length);
    if (!subPath) //they are identical
      return { siteOnLocation: containing.id };
    if (!await hasForeignFolderAt(containing.id, subPath))
      return { neededFolder: { inSite: containing.id, path: subPath, forSite } };
  }

  //Now find any sites that would be contained by us. We need foreign folders at their locations
  for (const contained of others.filter(site => site.outputfolder.toUpperCase().startsWith(upperFolder))) {
    const subPath = contained.outputfolder.substring(folder.length);
    if (!subPath) //they are identical
      return { siteOnLocation: contained.id };
    if (!await hasForeignFolderAt(forSite, subPath))
      return { neededFolder: { inSite: forSite, path: subPath, forSite: contained.id } };
  }
  return null;
}

/** Ensure a foreign folder exists at a path inside a site. Missing parents are created as normal folders */
async function ensureForeignFolder(site: Site, path: string): Promise<void> {
  const parts = path.split("/").filter(Boolean);
  if (!parts.length || parts.some(part => part === "." || part === ".."))
    throw new Error(`Invalid folder '${path}' for a foreign folder in site '${site.name}'`);

  let current = await openFolder(site.id);
  for (const [idx, name] of parts.entries()) {
    const isLast = idx === parts.length - 1;
    const child = await current.openFileOrFolder(name, { allowMissing: true });
    if (!child) {
      current = await current.createFolder(name, { type: isLast ? foreignFolderType : normalFolderType });
      continue;
    }

    if (!child.isFolder)
      throw new Error(`Cannot create a foreign folder at '${path}' in site '${site.name}': '${child.whfsPath}' is a file`);
    if (child.type === foreignFolderType)
      return; //anything below a foreign folder is outside the site
    if (isLast) {
      if (child.type !== normalFolderType)
        throw new Error(`Cannot create a foreign folder at '${path}' in site '${site.name}': '${child.whfsPath}' is a folder of type '${child.type}'`);
      if ((await child.list()).length)
        throw new Error(`Cannot create a foreign folder at '${path}' in site '${site.name}': '${child.whfsPath}' is not empty`);
      await child.update({ type: foreignFolderType });
    }
    current = child;
  }
}

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

  /** Set where the site is published
   * @param output - The new output, or null to stop publishing the site. Publishing into another site creates a foreign
   *   folder there, or converts an empty normal folder into one
   * @throws If another site already uses the location, or a foreign folder is needed that we can't create */
  async setOutput(output: SiteOutput | null) {
    let webServer: number | null = null, folder = "";
    if (output && "site" in output) {
      const parentSite = await loadSite(output.site.id);
      if (!parentSite)
        throw new Error(`No such site ${formatPathOrId(output.site.id)}`);
      if (parentSite.id === this.id)
        throw new Error(`Site '${this.name}' cannot be published into itself`);
      if (!parentSite.outputweb)
        throw new Error(`Site '${this.name}' cannot be published into site '${parentSite.name}': that site has no output`);

      webServer = parentSite.outputweb;
      folder = normalizeOutputFolder(parentSite.outputfolder + output.folder);
    } else if (output) {
      if (!output.webServer)
        throw new Error(`Invalid webserver #${output.webServer}, pass null to setOutput to stop publishing a site`);

      webServer = output.webServer;
      folder = normalizeOutputFolder(output.folder);
    }

    if (webServer && this.id === whconstant_whfsid_webharebackend) {
      const outputServer = await db<PlatformDB>().selectFrom("system.webservers").select("type").where("id", "=", webServer).executeTakeFirst();
      if (outputServer?.type !== whconstant_webservertype_interface)
        throw new Error(`Webserver #${webServer} is not an interface webserver, and not acceptable for the WebHare backend site`);
      if (folder !== "/")
        throw new Error(`Output folder '${folder}' is not acceptable for the WebHare backend site, the output folder MUST be '/'`);
    }

    const checkConflicts = async (server: number, options?: { containedOnly?: boolean }) => {
      const conflict = await findOutputConflict(this.id, server, folder, options);
      if (conflict && "siteOnLocation" in conflict)
        throw new Error(`Site '${await getSiteName(conflict.siteOnLocation)}' is already published at the new output folder '${folder}'`);
      if (conflict) {
        const { inSite, path, forSite } = conflict.neededFolder;
        throw new Error(`Site '${await getSiteName(inSite)}' needs a foreign folder at '${path}' to publish site '${await getSiteName(forSite)}' there`);
      }
    };
    const outputChanged = webServer !== this.dbrow.outputweb || folder !== this.dbrow.outputfolder;

    if (output && "site" in output) { //do this even if our output doesn't change, the folder may have been removed
      if (outputChanged && webServer) //check the sites we would contain first, so a refused output doesn't leave new folders behind
        await checkConflicts(webServer, { containedOnly: true });
      await ensureForeignFolder(output.site, output.folder);
    }

    if (!outputChanged)
      return;

    if (webServer)
      await checkConflicts(webServer);

    await db<PlatformDB>().updateTable("system.sites").set({ outputweb: webServer, outputfolder: folder }).where("id", "=", this.id).execute();
    await this.finishUpdate(Boolean(webServer));
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

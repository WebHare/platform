import type { CSPApplyTo, CSPApplyRule, CSPApplyToTo, CSPPluginBase, CSPPluginDataRow, CSPPluginSettingsRow } from "./siteprofiles";
import { openFolder, type WHFSObject, type WHFSFolder, describeWHFSType, openType, lookupURL, type LookupURLOptions } from "./whfs";
import { db, type Selectable } from "@webhare/whdb";
import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { isLike, isNotLike } from "@webhare/hscompat/src/strings";
import { emplace, nameToSnakeCase, omit, pick, slugify, toCamelCase } from "@webhare/std";
import { getExtractedConfig, getExtractedHSConfig } from "@mod-system/js/internal/configuration";
import { isHistoricWHFSSpace, openFileOrFolder } from "./objects";
import type { SiteRow } from "./sites";
import type { CookieOptions } from "@webhare/dompack/src/cookiebuilder";
import { tagToJS } from "@webhare/wrd/src/wrdsupport";
import { selectSitesWebRoot } from "@webhare/whdb/src/functions";
import { checkModuleScopedName } from "@webhare/services/src/naming";
import type { GlobalRight, TargettedRight } from "@webhare/auth";
import { getType } from "./describe";

export interface WebDesignInfo {
  objectname: string;
  witty: string;
}

export type WRDAuthPluginSettings = {
  wrdSchema: string | null;
  loginPage: string | null;
  cookieName: string;
  customizer: string | null;
  cookieDomain: string | null;
  sameSite: CookieOptions["sameSite"];
  supportObjectName: string | null;
  cacheFields: string[] | null;
  firstLoginField: string | null;
  lastLoginField: string | null;
};

interface PluginData extends CSPPluginBase {
  datas: CSPPluginDataRow[];
}

interface SiteApplicabilityInfo {
  siteprofileids: number[];
  roottype: number;
  sitedesign: string;
}

///describe a specific site for apply testing
async function getSiteApplicabilityInfo(siteid: number | null): Promise<SiteApplicabilityInfo> {
  const match = getExtractedHSConfig("siteprofilerefs").find(_ => _.id === siteid);
  return match ? pick(match, ["siteprofileids", "roottype", "sitedesign"]) : { siteprofileids: [], roottype: 0, sitedesign: "" };
}

function matchPathRegex(pattern: string, path: string | null): boolean {
  if (path === null)
    return false;

  const compiledpattern = new RegExp(pattern, 'i');
  return compiledpattern.test(path);
}

interface BaseInfo extends SiteApplicabilityInfo {
  site: SiteRow | null;
  obj: WHFSObject | null;
  parent: WHFSFolder;
  isfile: boolean;
  type: string;
  typeneedstemplate: boolean;
  /** Name, set for mocked objects */
  name?: string;
}

function isResourceMatch(rule_siteprofileids: number[], test_siteprofileids: number[]) {
  // RETURN Length(rule_siteprofileids) = 0 //applies everywhere
  //  OR Length(ArrayIntersection(rule_siteprofileids, test_siteprofileids)) > 0;
  return rule_siteprofileids.length === 0 //Rule applies everywhere
    || rule_siteprofileids.filter(_ => test_siteprofileids.includes(_)).length > 0; //intersection between sets
}

export function buildPluginData(datas: CSPPluginDataRow[]): Omit<CSPPluginDataRow, '__attributes' | '__location'> {
  /* this is the more-or-less equivalent of CombinePartialNodes. it receives one or more records of the format

    account: 'GTM-TN7QQM',
    integration: 'script',
    launch: 'pagerender',
    __attributes: [ 'ACCOUNT' ],
    __location: 'mod::webhare_testsuite/webdesigns/basetestjs/basetestjs.siteprl.xml:63'

    It should take the first record as returnvalue (without the __ props) and for the following records, merge only the cells mentioned in __attributes.
    Note that __attributes is uppercase but the cells themselvs are lowercase
   */
  const data = omit(datas[0], ['__attributes', '__location']);
  for (const row of datas.slice(1))
    for (const key of row.__attributes.map(attr => attr.toLowerCase()))
      data[key] = row[key];

  return data;
}

export function getWRDPlugindata(data: Record<string, unknown> | null): WRDAuthPluginSettings {
  const wrdSchema = data?.wrdschema as string || null;
  // TODO More users should probably rely on automatic cookieName selection!
  const cookieName = (data?.cookiename as string | null) || (wrdSchema ? "webharelogin-" + slugify(wrdSchema.replaceAll(":", "-")) : "webharelogin");

  /* Unparsed so far:
  - passwordresetlifetime := ToInteger(node->GetAttribute("passwordresetlifetime"), 3 * 24 * 60) //in minutes
  - servicemailtemplate := siteprofile->ParseFSPath(node, "servicemailtemplate")
  - routerfeatures := ParseXSList(node->GetAttribute("routerfeatures"))
  - authpageswitty := siteprofile->ParseFSPath(node, "authpageswitty")
*/
  return {
    wrdSchema,
    loginPage: data?.loginpage as string || null,
    cookieName,
    supportObjectName: data?.supportobjectname as string || null,
    customizer: data?.customizer as string || null,
    cookieDomain: data?.cookiedomain as string || null,
    cacheFields: data?.cachefields as string[] || null,
    sameSite: (data?.samesitecookie || "Lax") as CookieOptions["sameSite"],
    firstLoginField: data?.firstloginfield ? tagToJS(data?.firstloginfield as string) : null,
    lastLoginField: data?.lastloginfield ? tagToJS(data?.lastloginfield as string) : null
  };
}

async function getBaseInfoForMockedApplyCheck(parent: WHFSFolder, isFolder: boolean, type: string, name: string): Promise<BaseInfo> {
  const siteapply = await getSiteApplicabilityInfo(parent.parentSite);
  let site: SiteRow | null = null;
  if (parent.parentSite) {
    site = await db<PlatformDB>().selectFrom("system.sites").
      selectAll().
      select(selectSitesWebRoot().as("webroot")).
      where("id", "=", parent.parentSite).executeTakeFirst() ?? null; //TODO why doesn't getSiteApplicabilityInfo give us what we need here
  }

  let typeneedstemplate = false;
  if (!isFolder) {
    const typeinfo = await describeWHFSType(type, { allowMissing: true });
    if (typeinfo?.metaType === "fileType" && typeinfo.isWebPage)
      typeneedstemplate = true;
  }

  return {
    ...siteapply,
    obj: null,
    site,
    parent,
    isfile: !isFolder,
    type,
    typeneedstemplate,
    name,
  };
}

function isNotLikeMask(input: string | null, mask: string): boolean {
  return input !== null && isNotLike(input.toUpperCase(), mask.toUpperCase());
}

async function getHistoricBaseInfo(obj: WHFSObject): Promise<BaseInfo> {
  let origparentid: number = 0, currentname = '';

  const recycleinfo = await db<PlatformDB>().selectFrom("system.fs_history").
    select(["fs_object", "currentname", "currentparent"]).
    where("fs_object", "=", obj.id).
    where("type", "=", 0).
    execute();

  if (recycleinfo.length !== 1 || !recycleinfo[0].currentparent)
    throw new Error(`No recycle info found for ${obj.id}`);

  origparentid = recycleinfo[0].currentparent;
  currentname = recycleinfo[0].currentname;

  //TODO chase parents that are already deleted/historic
  const origparent = await openFolder(origparentid!);
  return getBaseInfoForMockedApplyCheck(origparent, obj.isFolder, obj.type, currentname);
}

export async function getBaseInfoForApplyCheck(obj: WHFSObject): Promise<BaseInfo> {
  if (isHistoricWHFSSpace(obj.whfsPath))
    return await getHistoricBaseInfo(obj);

  const siteapply = await getSiteApplicabilityInfo(obj.parentSite);
  let site: SiteRow | null = null;
  if (obj.parentSite) {
    site = await db<PlatformDB>().selectFrom("system.sites").
      selectAll().
      select(selectSitesWebRoot().as("webroot")).
      where("id", "=", obj.parentSite).executeTakeFirst() ?? null; //TODO why doesn't getSiteApplicabilityInfo give us what we need here
  }

  let typeneedstemplate = false;
  if (obj.isFile) {
    const typeinfo = await describeWHFSType(obj.type, { allowMissing: true });
    if (typeinfo?.metaType === "fileType" && typeinfo.isWebPage)
      typeneedstemplate = true;
  }
  if (!obj.parent && obj.isFile)
    throw new Error(`File ${obj.id} has no parent folder`);

  //TODO don't actually open the objects if we can avoid it.
  return {
    ...siteapply,
    obj,
    site,
    parent: obj.parentSite === obj.id || !obj.parent ? (obj as WHFSFolder) //a root *has* to be a folder
      : (await openFolder(obj.parent)),
    isfile: obj.isFile,
    type: obj.type,
    typeneedstemplate,
  };
}

export class WHFSApplyTester {
  private readonly objinfo: BaseInfo;
  constructor(objinfo: BaseInfo) {
    this.objinfo = objinfo;
  }

  //TODO shouldn't take access to dbrecord, just need to add some more fields to the base types
  private async toIsMatch(element: CSPApplyTo, site: SiteRow | null, folder: WHFSFolder | null): Promise<boolean> {
    switch (element.type) {
      case "and":
        for (const crit of element.criteria)
          if (!await this.toIsMatch(crit, site, folder))
            return false;

        return true;

      case "or":
        for (const crit of element.criteria)
          if (await this.toIsMatch(crit, site, folder))
            return true;
        return false;

      case "not":
        for (const crit of element.criteria)
          if (await this.toIsMatch(crit, site, folder))
            return false;
        return true;

      case "testdata": { /* TODO can we git rid of <testdata> ? it's one of the few reasons why
                            we are async and have to be able to reach out to the DB (and implement caching which is also gets
                            flaky very fast... just see the <testdata> tests in HS) */
        const totest = element.target === "parent" ? folder && folder.id : element.target === "root" ? site?.id || 0 : this.objinfo.obj?.id || 0;
        if (!totest)
          return false;

        //TODO select only the field we need
        const field = (await openType(element.typedef).get(totest))[element.membername];

        if (typeof field === "string")
          return field === (element?.value ?? '');
        if (typeof field === "number")
          return field === (element?.value ? Number(element.value) : 0);
        if (typeof field === "boolean")
          return field === (element?.value ? element.value === "true" || element.value === true : false);
        if (field instanceof Date && element?.value)
          return field.getTime() === new Date(String(element.value)).getTime(); //new Date("invalid").getTime() === nan
        else if (field === null) //just like HS <testdata> is very limited, we'll assume null is a DEFAULT DATETIME. in practice that's tested for using value="" so..
          return !element.value;

        return false;
      }

      case "to": {
        if (element.match_file && !this.objinfo.isfile)
          return false;
        if (element.match_index && (!folder || folder.indexDoc !== this.objinfo.obj?.id))
          return false;
        if (element.match_folder && this.objinfo.isfile)
          return false;
        if (element.whfstype && !this.matchType(this.objinfo.type, element.whfstype, !this.objinfo.isfile))
          return false;
        if (element.foldertype || element.filetype) {
          if (element.foldertype && (this.objinfo.isfile || !this.matchType(this.objinfo.type, element.foldertype, true)))
            return false;
          if (element.filetype && (!this.objinfo.isfile || !this.matchType(this.objinfo.type, element.filetype, false)))
            return false;
        }
        if (element.typeneedstemplate && !this.isTypeNeedsTemplate())
          return false;
        if (element.webfeatures?.length && !this.matchWebFeatures(element.webfeatures))
          return false;

        //TODO can we somehow share with GetMatchesBySiteFilter ?
        if (element.sitename && (!site || site.name.toUpperCase() !== element.sitename.toUpperCase()))
          return false;
        if (element.sitemask && (!site || isNotLike(site.name.toUpperCase(), element.sitemask.toUpperCase())))
          return false;
        if (element.siteregex && (!site || !matchPathRegex(element.siteregex, site.name)))
          return false;
        if (element.webrootregex && (!site || !matchPathRegex(element.webrootregex, site.webroot)))
          return false;
        if (!await this.testPathConstraint(element, site, folder))
          return false;
      }
    }
    return true;
  }

  private getPath(which: "whfsPath" | "sitePath") {
    if (this.objinfo.obj)
      return this.objinfo.obj[which] || null;
    // We generate a path based on the parent path and the name of the mocked object. HareScript would always use "NEW OBJECT" as a name
    if (this.objinfo.parent.sitePath)
      return `${(this.objinfo.parent.sitePath + this.objinfo.name)}${this.objinfo.isfile ? "" : "/"}`;

    return null;
  }

  private async matchWithinType(folderType: string, matchwith: string, isfolder: boolean) {
    //TODO API to optimize patterns like this and get the tree in one query.
    let tryparent: number | null = this.objinfo.parent.id;
    for (let maxdepth = 16; maxdepth > 0 && tryparent; maxdepth--) {
      const rec = await db<PlatformDB>().selectFrom("system.fs_objects").select(["id", "type", "parent"]).where("id", "=", tryparent).executeTakeFirst();
      if (!rec)
        return false;

      const typeInfo = await describeWHFSType(rec.type || 0, { allowMissing: true, metaType: "folderType" });
      if (typeInfo && isLike(typeInfo.namespace, matchwith))
        return true;

      if (this.objinfo.site && rec.parent === this.objinfo.site.id)
        break;

      tryparent = rec.parent;
    }
    return false;
  }

  private async testPathConstraint(rec: CSPApplyToTo, site: SiteRow | null, parentitem: WHFSFolder | null): Promise<boolean> {
    if (rec.pathmask && (!this.objinfo.site || isNotLikeMask(this.getPath("sitePath"), rec.pathmask)))
      return false;
    if (rec.parentmask && (!parentitem || isNotLikeMask(parentitem.sitePath, rec.parentmask)))
      return false;

    //TODO decide whether the API should still expose numeric types.... or have siteprofiles simply make them irrelevant (do we still support numbers *anywhere*? )
    const numerictype = (parentitem as unknown as { dbrecord: Selectable<PlatformDB, "system.fs_objects"> }).dbrecord.type;
    if (rec.parenttype && (!parentitem || !this.matchType(numerictype, rec.parenttype, true)))
      return false;
    if (rec.withintype && (!parentitem || !await this.matchWithinType(parentitem.type, rec.withintype, true)))
      return false; //Implement this, but we'll need to gather more info during baseobj info OR become async too
    if (rec.whfspathmask && isNotLikeMask(this.getPath("whfsPath"), rec.whfspathmask))
      return false;
    if (rec.sitetype !== "" && (!site || !this.matchType(this.objinfo.roottype, rec.sitetype, true)))
      return false;
    if (rec.pathregex && !matchPathRegex(rec.pathregex, this.getPath("sitePath")))
      return false;
    if (rec.whfspathregex && !matchPathRegex(rec.whfspathregex, this.getPath("whfsPath")))
      return false;
    if (rec.parentregex && (!parentitem || !matchPathRegex(rec.parentregex, parentitem.sitePath)))
      return false;

    return true;
  }

  __getHSInfo() {
    return {
      ismocked: this.isMocked(),
      objectid: this.objinfo.obj?.id ?? 0,
      parentfolder: this.objinfo.parent?.id ?? 0,
      type: this.objinfo.type,
      name: this.objinfo.name || ''
    };
  }

  /** Get target object for rights checks */
  getRightsTarget(): number | null {
    return this.objinfo.obj?.id || this.objinfo.parent?.id || null;
  }

  isMocked() {
    return !this.objinfo.obj;
  }

  isTypeNeedsTemplate() {
    return this.objinfo.typeneedstemplate;
  }

  /** Are any of these webfeatures active? ('to webfeatures=') */
  matchWebFeatures(masks: string[]) {
    /*
    PUBLIC BOOLEAN FUNCTION MatchWebfeatures(STRING ARRAY masks)
    {
      OBJECT sitesettingstype := OpenWHFSType("http://www.webhare.net/xmlns/publisher/sitesettings");
      FOREVERY (STRING feature FROM sitesettingstype->GetInstanceData(this.objsite).webfeatures)
        IF (MatchCommonXMLWildcardMasks(feature, masks))
          RETURN TRUE;
      RETURN FALSE;
    }*/
    return false; //FIXME implement but shouldn't this be in the site applicability cache and thus already available?
  }

  matchType(folderType: string | number | null, matchwith: string, isfolder: boolean) {
    folderType = folderType ?? 0; // emulate HareScript behaviour for typeless files/folders
    if (folderType && typeof folderType === 'number' && folderType < 1000 && matchwith === String(folderType)) //only match by ID for well-knowns
      return true;

    const types = getExtractedHSConfig("siteprofiles").contenttypes;
    const matchtype = typeof folderType === "string" ?
      types.find(_ => (isfolder ? _.foldertype : _.filetype) && (_.scopedtype === folderType || _.namespace === folderType))
      :
      types.find(_ => (isfolder ? _.foldertype : _.filetype) && (_.id === folderType));

    return matchtype && (isLike(matchtype.namespace, matchwith) || isLike(matchtype.scopedtype, matchwith));
  }

  private async applyIsMatch(apply: CSPApplyRule): Promise<boolean> {
    if (!isResourceMatch(apply.siteprofileids, this.objinfo.siteprofileids))
      return false;
    if (apply.whfstype) {
      return this.objinfo.type === apply.whfstype;
    }

    try {
      for (const appl of apply.tos)
        if (await this.toIsMatch(appl, this.objinfo.site, this.objinfo.parent))
          return true;
    } catch (e) {
      (e as Error).message += ` (evaluating ${apply.siteprofile}#${apply.line})`;
      throw e;
    }
    return false;
  }

  /** List all matching apply rules
   * @param propname -- Only return rules that have this property set. null to get all rules
   */
  private async getMatchingRules<Prop extends keyof CSPApplyRule>(propname: Prop | null, yamlonly = false) {
    const siteprofs = getExtractedHSConfig("siteprofiles");
    //Mark the Prop as never null or we wouldn't have returned it
    const resultset: Array<{ [key in Prop]: NonNullable<CSPApplyRule[Prop]> } & Omit<CSPApplyRule, Prop>> = [];
    for (const rule of siteprofs.applies) {
      if (yamlonly && !rule.yaml)
        continue;

      if (propname) { //test if the property is set, skip actual matching if there isn't anything interesting in this rule
        const propvalue = (rule as unknown as { [key: string]: unknown })[propname];
        if (!propvalue || (Array.isArray(propvalue) && !propvalue.length) || (yamlonly && !rule.yaml))
          continue;
      }

      if (await this.applyIsMatch(rule))
        resultset.push(rule);
    }
    return resultset;
  }

  //TODO should we just expose getMatchingRules instead?
  async __getCustomFields() {
    return {
      baseprops: await this.getMatchingRules('baseproperties', true),
      extendprops: await this.getMatchingRules('extendproperties', true)
    };
  }

  //Debugging API. get all current matches
  async __getAllMatches({ yamlonly = false } = {}) {
    return this.getMatchingRules(null, yamlonly);
  }

  async getPluginData(namespace: string, name: string): Promise<Omit<CSPPluginDataRow, '__attributes' | '__location'> | null> {
    const rows: CSPPluginDataRow[] = [];
    for (const apply of await this.getMatchingRules('plugins'))
      for (const plugin of apply.plugins)
        if (plugin.name === name && plugin.namespace === namespace && plugin.data)
          rows.push(plugin.data);

    return rows.length ? buildPluginData(rows) : null;
  }

  async getExtendProps() {
    const extendProps: Array<{
      whfsType: string;
      requireRight?: GlobalRight | TargettedRight;
      extension: string;
    }> = [];
    for (const apply of await this.getMatchingRules('extendproperties')) {
      for (const extend of apply.extendproperties)
        if (extend.extension)
          extendProps.push({
            whfsType: extend.contenttype || '',
            extension: extend.extension,
            ...extend.requireright ? { requireRight: extend.requireright } : undefined,
          });
    }
    return extendProps;
  }

  async getObjectEditor() {
    let name = '';
    for (const apply of await this.getMatchingRules('setobjecteditor')) {
      name = apply.setobjecteditor.name;
    }

    if (name) {
      const doceditor = getExtractedConfig("plugins").objectEditors.find(_ => _.name === name);
      if (doceditor)
        return doceditor;
    }

    return null;
  }

  /** Get the plugin settings associated with the specified name
      @param name The name of the plugin, corresponding to a <module>:<name> property. Snake case if it was mixed case in the YAML
      @return An array of settings records found. Each record includes a 'source' member specifying the source site profile rule. It's up to the caller to merge them as needed
  */
  async getPluginSettings(name: string): Promise<CSPPluginSettingsRow[]> {
    //FIXME consider whether we can replace getPluginData/getUserData ?
    name = nameToSnakeCase(name);
    checkModuleScopedName(name);
    const cellname: keyof CSPApplyRule = "yml_" + name as keyof CSPApplyRule;

    const rows: CSPPluginSettingsRow[] = [];
    for (const apply of await this.getMatchingRules(cellname))
      for (const setting of apply[cellname as keyof typeof apply] as CSPPluginDataRow[] || [])
        rows.push({
          source: { siteProfile: apply.siteprofile },
          ...toCamelCase(setting)
        });

    return rows;
  }

  async getWRDAuth() {
    const data = await this.getPluginData("http://www.webhare.net/xmlns/wrd", "wrdauth");
    return getWRDPlugindata(data);
  }

  async getSiteLanguage() {
    let lang = 'en';
    for (const apply of await this.getMatchingRules('sitelanguage')) {
      if (apply.sitelanguage.has_lang)
        lang = apply.sitelanguage.lang;
    }
    return lang;
  }

  async getWebDesignInfo() {
    //Inspired on GetWebDesignObjinfo()
    const webDesign = {
      objectName: "mod::publisher/lib/webdesign.whlib#WebDesignBase",
      siteResponseFactory: "",
      pageBuilder: "",
      witty: "mod::publisher/lib/defaultwebdesign.witty",
      assetPack: "",
      designFolder: "",
      maxContentWidth: "",
      wittyEncoding: "HTML",
      defaultGid: "",

      renderInfo: null,
      supportsErrors: true,
      supportsAccessDenied: false,
      siteProfile: "",
      is404: false,
      contentNavStops: [] as string[],

      plugins: [] as PluginData[]
    };

    for (const apply of await this.getMatchingRules('webdesign')) {
      //specifying either HS (objectname) or JS rendering (getdata) invalidates the other
      if (apply.webdesign.objectname) {
        webDesign.objectName = apply.webdesign.objectname;
        webDesign.siteResponseFactory = '';
        webDesign.pageBuilder = '';
      } else if (apply.webdesign.siteresponsefactory || apply.webdesign.pagebuilder) {
        webDesign.objectName = '';
        webDesign.siteResponseFactory = apply.webdesign.siteresponsefactory;
        webDesign.pageBuilder = apply.webdesign.pagebuilder || '';
      }
      webDesign.witty = apply.webdesign.witty ?? webDesign.witty;
      webDesign.designFolder = apply.webdesign.designfolder ?? webDesign.designFolder;
      webDesign.maxContentWidth = apply.webdesign.maxcontentwidth ?? webDesign.maxContentWidth;
      webDesign.siteProfile = apply.siteprofile;
      webDesign.wittyEncoding = apply.webdesign.wittyencoding ?? webDesign.wittyEncoding;

      if (apply.webdesign.has_assetpack) {
        webDesign.assetPack = apply.webdesign.assetpack;
      }

      webDesign.supportsErrors = apply.webdesign.has_supportserrors ? apply.webdesign.supportserrors : webDesign.supportsErrors;
      webDesign.supportsAccessDenied = apply.webdesign.has_supportsaccessdenied ? apply.webdesign.supportsaccessdenied : webDesign.supportsAccessDenied;
      webDesign.contentNavStops = apply.webdesign.has_contentnavstops ? apply.webdesign.contentnavstops : webDesign.contentNavStops;
    }

    /* FIXME content link support. we should consider
         a) loading the contentlink-reference during getBaseInfoForApplyCheck or even when opening ?
         b) having our caller deal with this. I'm not sure JS will even require us to explain the file already
    if(this->objinfo.obj.type.namespace === "http://www.webhare.net/xmlns/publisher/contentlink")

       = 20)//content link
      {
        OBJECT link_tester := GetApplyTesterForObject(this->objinfo.obj.filelink);
        IF (ObjectExists(link_tester))
          webdesign.renderinfo := link_tester->GetObjRenderInfo();
        ELSE
          webdesign.is404 := TRUE;
      }
      ELSE
      {
        webdesign.renderinfo := this->GetObjRenderInfo();
      }*/
    //Parse plugins (combines configuration data for later parsing)
    const namedplugins = new Map<string, PluginData>;
    const customplugins: PluginData[] = [];

    for (const apply of await this.getMatchingRules('plugins')) {
      for (const plugin of apply.plugins)
        if (plugin.data)
          if (plugin.combine) //this is a normal plugin where we merge configuration
            emplace(namedplugins, plugin.name, {
              insert: () => ({ ...plugin, datas: [plugin.data!] }),
              update: cur => ({ ...cur, datas: [...cur.datas, plugin.data!] })
            });
          else
            customplugins.push({ ...plugin, datas: [plugin.data] });
    }

    webDesign.plugins = [...namedplugins.values(), ...customplugins];
    return webDesign;
  }

  async getObjRenderInfo() {
    const baseinfo = { renderer: "" };
    for (const apply of await this.getMatchingRules('bodyrenderer'))
      if (apply.bodyrenderer?.renderer)
        baseinfo.renderer = apply.bodyrenderer?.renderer;

    return baseinfo;
  }

  async getUserData(key: string) {
    let userdata: Record<string, unknown> | null = null;

    for (const apply of await this.getMatchingRules('userdata'))
      for (const userdataentry of apply.userdata)
        if (userdataentry.key === key)
          userdata = { ...(userdata || {}), ...JSON.parse(userdataentry.value) };

    return userdata;
  }

  async getWidgetSettings(type: string): Promise<{
    renderHS: string; //HareScript renderer
    renderJS: string; //JS renderer
  }> {
    const retval = { renderHS: "", renderJS: "" };
    const typeInfo = getType(type);
    if (!typeInfo)
      return retval;

    if (typeInfo.renderer?.objectname)
      retval.renderHS = typeInfo.renderer.objectname;
    if (typeInfo.widgetbuilder)
      retval.renderJS = typeInfo.widgetbuilder;

    for (const applyRule of await this.getMatchingRules("setwidget")) {
      for (const set of applyRule.setwidget) {
        if (set.contenttype && (set.contenttype === typeInfo?.namespace || set.contenttype === typeInfo?.scopedtype)) {
          retval.renderHS = set.renderer?.objectname || '';
          retval.renderJS = set.widgetbuilder || '';
        }
      }
    }

    return retval;
  }
}

export async function getApplyTesterForObject(obj: WHFSObject) {
  return new WHFSApplyTester(await getBaseInfoForApplyCheck(obj));
}

export async function getApplyTesterForMockedObject(parent: WHFSFolder, isFolder: boolean, type: string, name = "new object") {
  return new WHFSApplyTester(await getBaseInfoForMockedApplyCheck(parent, isFolder, type, name)); //TODO root object support
}

export async function getApplyTesterForURL(url: string, options?: LookupURLOptions) {
  const lookupresult = await lookupURL(new URL(url), options);
  if (!lookupresult || !lookupresult.folder)
    return null;

  const obj = await openFileOrFolder(lookupresult.file ?? lookupresult.folder);
  return getApplyTesterForObject(obj);
}

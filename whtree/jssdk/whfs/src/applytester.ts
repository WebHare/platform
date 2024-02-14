import { CSPApplyTo, CSPApplyRule, getCachedSiteProfiles, CSPApplyToTo, CSPPluginBase, CSPPluginDataRow } from "./siteprofiles";
import { openFolder, WHFSObject, WHFSFolder, describeContentType } from "./whfs";
import { db, Selectable } from "@webhare/whdb";
import type { PlatformDB } from "@mod-system/js/internal/generated/whdb/platform";
import { isLike, isNotLike } from "@webhare/hscompat/strings";
import { emplace } from "@webhare/std";
import { loadlib } from "@webhare/harescript";

export interface WebDesignInfo {
  objectname: string;
  witty: string;
}

interface PluginData extends CSPPluginBase {
  datas: CSPPluginDataRow[];
}

interface SiteApplicabilityInfo {
  siteprofileids: number[];
  roottype: number;
  sitedesign: string;
}

///describe a specific site for apply testing
async function getSiteApplicabilityInfo(siteid: number | null) {
  const readerwhlib = loadlib("mod::publisher/lib/internal/siteprofiles/reader.whlib");
  return await readerwhlib.GetSiteApplicabilityInfo(siteid ?? 0) as SiteApplicabilityInfo;
}

function matchPathRegex(pattern: string, path: string): boolean {
  const compiledpattern = new RegExp(pattern, 'i');
  return compiledpattern.test(path);
}

interface BaseInfo extends SiteApplicabilityInfo {
  site: Selectable<PlatformDB, "system.sites"> | null;
  obj: WHFSObject;
  parent: WHFSFolder | null;
  isfile: boolean;
  isfake: boolean;
  typeneedstemplate: boolean;
}

function isResourceMatch(rule_siteprofileids: number[], test_siteprofileids: number[]) {
  // RETURN Length(rule_siteprofileids) = 0 //applies everywhere
  //  OR Length(ArrayIntersection(rule_siteprofileids, test_siteprofileids)) > 0;
  return rule_siteprofileids.length == 0 //Rule applies everywhere
    || rule_siteprofileids.filter(_ => test_siteprofileids.includes(_)).length > 0; //intersection between sets
}

export async function getBaseInfoForApplyCheck(obj: WHFSObject): Promise<BaseInfo> {
  // RECORD fsobjinfo := SELECT id, parent, parentsite, type, filelink, fullpath, whfspath, indexdoc, isfolder, url FROM system.fs_objects WHERE id = fsobjectid;
  // IF(NOT RecordExists(fsobjinfo))
  // RETURN DEFAULT RECORD;

  const siteapply = await getSiteApplicabilityInfo(obj.parentSite);
  let site: Selectable<PlatformDB, "system.sites"> | null = null;
  if (obj.parentSite) {
    site = await db<PlatformDB>().selectFrom("system.sites").selectAll().where("id", "=", obj.parentSite).executeTakeFirst() ?? null; //TODO why doesn't getSiteApplicabilityInfo give us what we need here
  }

  const typeneedstemplate = obj.isFile && ((await describeContentType(obj.type, { allowMissing: true }))?.isWebPage ?? false);

  //TODO don't actually open the objects if we can avoid it.
  return {
    ...siteapply,
    obj,
    site,
    parent: obj.parentSite === obj.id ? (obj as WHFSFolder) //a root *has* to be a folder
      : obj.parent ? (await openFolder(obj.parent)) : null,
    isfile: obj.isFile,
    isfake: false,
    typeneedstemplate
  };
}

export class WHFSApplyTester {
  private readonly objinfo: BaseInfo;
  constructor(objinfo: BaseInfo) {
    this.objinfo = objinfo;
  }

  /*

  BOOLEAN FUNCTION ToIsMatch(RECORD element, RECORD site, RECORD folder)
  {
  }
*/

  //TODO shouldn't take access to dbrecord, just need to add some more fields to the base types
  private async toIsMatch(element: CSPApplyTo, site: Selectable<PlatformDB, "system.sites"> | null, folder: WHFSFolder | null): Promise<boolean> {
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

      case "xor": {
        let sofar = false;
        for (const crit of element.criteria)
          sofar = sofar !== await this.toIsMatch(crit, site, folder);

        return sofar;
      }

      case "testdata": {
        const totest = element.target == "parent" ? folder && folder.id : element.target == "root" ? site?.id || 0 : this.objinfo.obj.id;
        if (!totest)
          return false;

        throw new Error("<testdata> not implemented yet!");
        /* Shouldn't take long given how essential GetInstanceData is...
        RECORD instance:= this -> cache -> GetInstanceData(element.typedef, testid);

        STRING membername:= element.membername;
        if (NOT CellExists(instance, membername))
        return false;

        if (TypeId(GetCell(instance, membername)) = TypeId(STRING) AND GetCell(instance, membername) = (CellExists(element, "VALUE") ? element.value : ""))
        return true;
        if (TypeId(GetCell(instance, membername)) = TypeId(INTEGER) AND GetCell(instance, membername) = (CellExists(element, "VALUE") ? ToInteger(element.value, -1) : 0))
        return true;
        if (TypeId(GetCell(instance, membername)) = TypeId(BOOLEAN) AND GetCell(instance, membername) = (CellExists(element, "VALUE") ? ParseXSBoolean(element.value) : FALSE))
        return true;
        if (TypeId(GetCell(instance, membername)) = TypeId(DATETIME) AND GetCell(instance, membername) = (CellExists(element, "VALUE") ? MakeDateFromText(element.value) : DEFAULT DATETIME))
        return true;

        return false;*/
      }

      case "to": {
        if (element.match_file && !this.objinfo.isfile)
          return false;
        if (element.match_index && (!folder || folder.indexDoc != this.objinfo.obj.id))
          return false;
        if (element.match_folder && this.objinfo.isfile)
          return false;
        //TODO decide whether the API should still expose numeric types.... or have siteprofiles simply make them irrelevant (do we still support numbers *anywhere*? )
        const numerictype = (this.objinfo.obj as unknown as { dbrecord: Selectable<PlatformDB, "system.fs_objects"> }).dbrecord.type;
        if (element.foldertype && !this.matchType(numerictype, element.foldertype, true))
          return false;
        if (element.filetype && !this.matchType(numerictype, element.filetype, false))
          return false;
        if (element.contentfiletype)
          return false; //FIXME: AND NOT this -> MatchType(this -> GetContentType(), element.contentfiletype, FALSE))
        if (element.typeneedstemplate && !this.isTypeNeedsTemplate())
          return false;
        if (element.prebuiltmasks?.length)
          return false; //These will probably never be suported by JS implementations as HS already deprecated them
        if (element.webfeatures?.length && !this.matchWebfeatures(element.webfeatures))
          return false;

        //TODO can we somehow share with GetMatchesBySiteFilter ?
        if (element.sitename && (!site || site.name.toUpperCase() != element.sitename.toUpperCase()))
          return false;
        if (element.sitemask && (!site || isNotLike(site.name.toUpperCase(), element.sitemask.toUpperCase())))
          return false;
        if (element.siteregex && (!site || !matchPathRegex(element.siteregex, site.name)))
          return false;
        if (element.webrootregex && (!site || !matchPathRegex(element.webrootregex, site.webroot)))
          return false;
        if (!this.testPathConstraint(element, site, folder))
          return false;
      }
    }
    return true;
  }

  testPathConstraint(rec: CSPApplyToTo, site: Selectable<PlatformDB, "system.sites"> | null, parentitem: WHFSFolder | null): boolean {
    if (rec.pathmask && isNotLike(this.objinfo.obj.fullPath.toUpperCase(), rec.pathmask.toUpperCase()))
      return false;
    if (rec.parentmask && (!parentitem || isNotLike(parentitem.fullPath.toUpperCase(), rec.parentmask.toUpperCase())))
      return false;

    //TODO decide whether the API should still expose numeric types.... or have siteprofiles simply make them irrelevant (do we still support numbers *anywhere*? )
    const numerictype = (parentitem as unknown as { dbrecord: Selectable<PlatformDB, "system.fs_objects"> }).dbrecord.type;
    if (rec.parenttype && (!parentitem || !this.matchType(numerictype, rec.parenttype, true)))
      return false;
    if (rec.withintype) //FIXME: && (!parentitem || ! this.matchWithinType(parentitem.type, rec.withintype,true)))
      return false; //Implement this, but we'll need to gather more info during baseobj info OR become async too
    if (rec.whfspathmask && !isNotLike(this.objinfo.obj.whfsPath.toUpperCase(), rec.whfspathmask.toUpperCase()))
      return false;
    if (rec.sitetype != "" && (!site || !this.matchType(this.objinfo.roottype, rec.sitetype, true)))
      return false;
    if (rec.pathregex && !matchPathRegex(rec.pathregex, this.objinfo.obj.fullPath))
      return false;
    if (rec.whfspathregex && !matchPathRegex(rec.whfspathregex, this.objinfo.obj.whfsPath))
      return false;
    if (rec.parentregex && (!parentitem || !matchPathRegex(rec.parentregex, parentitem.fullPath)))
      return false;

    return true;
  }

  isTypeNeedsTemplate() {
    return this.objinfo.typeneedstemplate;
  }

  /** Are any of these webfeatures active? ('to webfeatures=') */
  matchWebfeatures(masks: string[]) {
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

  matchType(folderType: number | null, matchwith: string, isfolder: boolean) {
    folderType = folderType ?? 0; // emulate HareScript behaviour for typeless files/folders
    if (folderType && folderType < 1000 && matchwith == String(folderType)) //only match by ID for well-knowns
      return true;

    const types = getCachedSiteProfiles().contenttypes;
    const matchtype = types.find(_ => (isfolder ? _.foldertype : _.filetype) && _.id == folderType);
    return matchtype && isLike(matchtype.namespace, matchwith);
  }

  private async applyIsMatch(apply: CSPApplyRule): Promise<boolean> {
    if (!isResourceMatch(apply.siteprofileids, this.objinfo.siteprofileids))
      return false;

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
   * @param propname -- Only return rules that have this property set
   */
  private async getMatchingRules(propname: string) {
    const siteprofs = getCachedSiteProfiles();
    const resultset: CSPApplyRule[] = [];
    for (const rule of siteprofs.applies) {
      const propvalue = (rule as unknown as { [key: string]: unknown })[propname];
      if (!propvalue || (Array.isArray(propvalue) && !propvalue.length))
        continue; //even if it matches, this rule wouldn't be interesting

      if (await this.applyIsMatch(rule))
        resultset.push(rule);
    }
    return resultset;
  }

  async getWRDAuth() {
    const wrdauth = {
      wrdSchema: null as null | string
    };

    for (const apply of await this.getMatchingRules('plugins')) {
      for (const plugin of apply.plugins)
        if (plugin.name == "wrdauth" && plugin.namespace == "http://www.webhare.net/xmlns/wrd") { //found a wrdauth plugin definition
          if (plugin.data.__attributes.includes("WRDSCHEMA"))
            wrdauth.wrdSchema = plugin.data.wrdschema as string;
        }
    }

    return wrdauth;
  }

  async getWebDesignInfo() {
    //Inspired on GetWebDesignObjinfo()
    const webdesign = {
      objectname: "mod::publisher/lib/webdesign.whlib#WebDesignBase",
      siteresponsefactory: "",
      witty: "mod::publisher/lib/defaultwebdesign.witty",
      assetpack: "",
      designfolder: "",
      maxcontentwidth: "",
      wittyencoding: "HTML",
      defaultgid: "",
      asyncbundle: false,

      renderinfo: null,
      supportserrors: true,
      supportsaccessdenied: false,
      supportedlanguages: [],
      siteprofile: "",
      is404: false,
      contentnavstops: [],
      lazyloadcss: false,

      plugins: [] as PluginData[]
    };

    for (const apply of await this.getMatchingRules('webdesign')) {
      webdesign.objectname = apply.webdesign.objectname ?? webdesign.objectname;
      webdesign.siteresponsefactory = apply.webdesign.siteresponsefactory ?? webdesign.siteresponsefactory;
      webdesign.witty = apply.webdesign.witty ?? webdesign.witty;
      webdesign.designfolder = apply.webdesign.designfolder ?? webdesign.designfolder;
      webdesign.maxcontentwidth = apply.webdesign.maxcontentwidth ?? webdesign.maxcontentwidth;
      webdesign.siteprofile = apply.siteprofile;
      webdesign.wittyencoding = apply.webdesign.wittyencoding ?? webdesign.wittyencoding;

      //assetpack also triggers setting supportedlanguages
      if (apply.webdesign.has_assetpack) {
        webdesign.assetpack = apply.webdesign.assetpack;
        webdesign.supportedlanguages = apply.webdesign.supportedlanguages;
      }

      webdesign.supportserrors = apply.webdesign.has_supportserrors ? apply.webdesign.supportserrors : webdesign.supportserrors;
      webdesign.supportsaccessdenied = apply.webdesign.has_supportsaccessdenied ? apply.webdesign.supportsaccessdenied : webdesign.supportsaccessdenied;
      webdesign.asyncbundle = apply.webdesign.has_asyncbundle ? apply.webdesign.asyncbundle : webdesign.asyncbundle;
      webdesign.contentnavstops = apply.webdesign.has_contentnavstops ? apply.webdesign.contentnavstops : webdesign.contentnavstops;
      webdesign.lazyloadcss = apply.webdesign.has_lazyloadcss ? apply.webdesign.lazyloadcss : webdesign.lazyloadcss;
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
        if (plugin.combine) //this is a normal plugin where we merge configuration
          emplace(namedplugins, plugin.name, {
            insert: () => ({ ...plugin, datas: [plugin.data] }),
            update: cur => ({ ...cur, datas: [...cur.datas, plugin.data] })
          });
        else
          customplugins.push({ ...plugin, datas: [plugin.data] });
    }

    webdesign.plugins = [...namedplugins.values(), ...customplugins];
    return webdesign;
  }

  async getObjRenderInfo() {
    const baseinfo = { renderer: "" };
    for (const apply of await this.getMatchingRules('bodyrenderer'))
      if (apply.bodyrenderer?.renderer)
        baseinfo.renderer = apply.bodyrenderer?.renderer;

    return baseinfo;
  }
}

export async function getApplyTesterForObject(obj: WHFSObject) {
  return new WHFSApplyTester(await getBaseInfoForApplyCheck(obj));
}

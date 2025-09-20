/* TODO establish the proper/stable approach with WHFSRequest. Eg open questions:
     - should we always return resolved objects (targetObject/targetFolder/...) or id ?
     - should we wrap Request objects during routing or should we just immediately create the proper object ?
*/

import { openFolder, openSite, type Site, type WHFSFolder, type WHFSObject } from "@webhare/whfs";
import { type Insertable, type InsertPoints, SiteResponse, SiteResponseSettings } from "./sitereponse";
import type { WebRequest } from "./request";
import { buildPluginData, getApplyTesterForObject, type WHFSApplyTester } from "@webhare/whfs/src/applytester";
import { wrapHSWebdesign } from "./hswebdesigndriver";
import { importJSFunction } from "@webhare/services";
import type { WebdesignPluginAPIs, WebResponse } from "@webhare/router";
import type { WHConfigScriptData } from "@webhare/frontend/src/init";
import { checkModuleScopedName } from "@webhare/services/src/naming";
import type { FrontendDataTypes } from "@webhare/frontend";
import { getExtractedConfig, getVersionInteger } from "@mod-system/js/internal/configuration";
import { dtapStage } from "@webhare/env";
import type { WittyData } from "@webhare/witty";

export type PluginInterface<API extends object> = {
  api: API;
};

/** @deprecated WH5.7 switches to getData over siteresponsefactory */
export type WebDesignFunction<T extends object> = (request: SiteRequest, settings: SiteResponseSettings) => Promise<SiteResponse<T>>;

export type WebDesignGetDataFunction = (request: ResponseBuilder) => Promise<WittyData>;


/** Defines the callback offered by a plugin (not exported from webhare/router yet, plugin APIs are still unstable) */
export type ResponseHookFunction<PluginDataType = Record<string, unknown>> = (response: ResponseBuilder, plugindata: PluginDataType) => Promise<void> | void;

class CSiteRequest {
  readonly webRequest: WebRequest;
  readonly targetObject: WHFSObject; //we could've gone for "WHFSFile | null" but then you'd *always* have to check for null. pointing to WHFSObject allows you to only check the real type sometimes
  readonly targetFolder: WHFSFolder;
  readonly targetSite: Site;
  readonly contentObject: WHFSObject;
  readonly navObject: WHFSObject;

  //buildSiteRequest will invoke _prepareResponse immediately to set these:
  #applyTester!: WHFSApplyTester;
  #siteLanguage!: string;

  get siteLanguage() {
    return this.#siteLanguage;
  }

  #plugins: {
    [Api in keyof WebdesignPluginAPIs]?: PluginInterface<WebdesignPluginAPIs[Api]>;
  } = {};

  _insertions: { [key in InsertPoints]?: Insertable[] } = {};

  /** JS configuration data */
  _frontendConfig: WHConfigScriptData;

  constructor(webRequest: WebRequest, targetSite: Site, targetFolder: WHFSFolder, targetObject: WHFSObject, { contentObject, navObject }: { contentObject?: WHFSObject; navObject?: WHFSObject } = {}) {
    this.webRequest = webRequest;
    this.targetSite = targetSite;
    this.targetFolder = targetFolder;
    this.targetObject = targetObject;
    this.contentObject = contentObject ?? targetObject;
    this.navObject = navObject ?? targetObject;

    this._frontendConfig = {
      siteRoot: this.targetSite.webRoot || "",
      site: {},
      obj: {},
      dtapStage: dtapStage,
      locale: "" as never,
      server: getVersionInteger() //TODO we intend to completely deprecate this. should never depend on server versions
    };
  }

  getPlugin<PluginType extends keyof WebdesignPluginAPIs>(api: PluginType): WebdesignPluginAPIs[PluginType] | null {
    return this.#plugins[api]?.api || null;
  }

  addPlugin<PluginType extends keyof WebdesignPluginAPIs>(api: PluginType, plugin: WebdesignPluginAPIs[PluginType]) {
    this.#plugins[api] = { api: plugin };
  }

  /** Insert a callback for use during rendering */
  insertAt(where: InsertPoints, what: Insertable) {
    if (!this._insertions[where])
      this._insertions[where] = [];
    this._insertions[where].push(what); //ensured above
  }

  /** Set data associated with a plugin */
  setFrontendData<Type extends keyof FrontendDataTypes>(dataObject: Type, data: FrontendDataTypes[Type]) {
    checkModuleScopedName(dataObject);
    this._frontendConfig[dataObject] = data;
  }

  async _renderInserts(point: InsertPoints) {
    let output = '';
    for (const insert of this._insertions[point] || []) {
      if (typeof insert === "string")
        output += insert;
      else
        output += await insert();
    }
    return output;
  }

  /** @deprecated createComposer is going away, switch to the ResponseBuilder in WH5.7 */
  async createComposer<T extends object = object>(options?: { __captureJSDesign?: boolean }): Promise<SiteResponse<T>> { //async because we may delay loading the actual webdesign code until this point
    const publicationsettings = await this.#applyTester.getWebDesignInfo();
    if (!publicationsettings.siteResponseFactory && !publicationsettings.getData) {
      if (options?.__captureJSDesign) //prevent endless loop
        throw new Error(`Inconsistent siteprofiles - createComposer for ${this.targetObject.whfsPath} (#${this.targetObject.id}) wants to invoke a HS design but was invoked by captureJSDesign`);
      return wrapHSWebdesign<T>(this);
    }

    if (publicationsettings.getData)
      throw new Error(`createComposer is not available for webdesigns that switched to getData`);

    const settings = new SiteResponseSettings;
    settings.assetpack = publicationsettings.assetPack;
    settings.witty = publicationsettings.witty;

    const assetPackInfo = getExtractedConfig("assetpacks").find(_ => _.name === publicationsettings.assetPack);
    settings.supportedlanguages = assetPackInfo?.supportedLanguages || [];
    settings.lang = this.#siteLanguage;

    const factory = await importJSFunction<WebDesignFunction<T>>(publicationsettings.siteResponseFactory);
    const composer = await factory(this, settings);

    return composer;
  }

  //TODO is this API actually useful somewhere or more of a debugging API we may remove ?
  async _prepareWitty() {
    const publicationsettings = await this.#applyTester!.getWebDesignInfo();

    //TODO this is a bit of a hack to get the data for the new renderer
    const getData = await importJSFunction<WebDesignGetDataFunction>(publicationsettings.getData);
    const data = await getData(this);

    return {
      witty: publicationsettings.witty,
      data: data
    };
  }

  async renderHTMLPage(content: string, options?: { __captureJSDesign?: boolean }): Promise<WebResponse> {
    const publicationsettings = await this.#applyTester!.getWebDesignInfo();
    if (!publicationsettings.getData) {
      let composer;

      if (publicationsettings.siteResponseFactory)
        composer = await this.createComposer(); //fallback to pre-5.7 rendering
      else if (options?.__captureJSDesign) //prevent endless loop
        throw new Error(`Inconsistent siteprofiles - renderHTMLPage for ${this.targetObject.whfsPath} (#${this.targetObject.id}) wants to invoke a HS design but was invoked by captureJSDesign`);
      else
        composer = await wrapHSWebdesign(this);

      composer.appendHTML(content);
      return composer.finish();
    }

    //TODO this is a bit of a hack to get the data for the new renderer
    const getData = await importJSFunction<WebDesignGetDataFunction>(publicationsettings.getData);
    const data = await getData(this);

    //TODO merge SiteResponse with us as soon as we've finished our refactoring (or do we need everyone to switch away from createComposer first?)
    const settings = new SiteResponseSettings;
    settings.assetpack = publicationsettings.assetPack;
    settings.witty = publicationsettings.witty;
    const assetPackInfo = getExtractedConfig("assetpacks").find(_ => _.name === publicationsettings.assetPack);
    settings.supportedlanguages = assetPackInfo?.supportedLanguages || [];
    settings.lang = this.#siteLanguage;

    const response = new SiteResponse<WittyData>(data, this, settings);
    response.appendHTML(content);
    return response.finish();
  }

  async _prepareResponse() {
    this.#applyTester = await getApplyTesterForObject(this.targetObject);
    this.#siteLanguage = await this.#applyTester.getSiteLanguage(); //FIXME we need to be in a CodeContext and set tid!

    const publicationsettings = await this.#applyTester.getWebDesignInfo();
    this._frontendConfig.locale = this.#siteLanguage as never; //FIXME why doesn't JS just get the html lang= ?

    for (const plugin of publicationsettings.plugins) { //apply plugins
      if (plugin.composerhook) {
        const plugindata = buildPluginData(plugin.datas);
        //TODO consider providing a callback at this for buildPluginData or applytester so plugins can freely access other plugin's data
        await (await importJSFunction<ResponseHookFunction>(plugin.composerhook))(this, plugindata);
      }
    }
  }
}

export async function buildSiteRequest(webRequest: WebRequest, targetObject: WHFSObject, { contentObject, navObject }: { contentObject?: WHFSObject; navObject?: WHFSObject } = {}): Promise<CSiteRequest> {
  if (!targetObject.parentSite)
    throw new Error(`Target '${targetObject.whfsPath}' (#${targetObject.id}) is not in a site`);

  const targetSite = await openSite(targetObject.parentSite);
  const targetFolder = targetObject.isFolder ? targetObject as WHFSFolder : targetObject.parent ? await openFolder(targetObject.parent) : null; //parent must exist if we're in a site.
  if (!targetFolder)
    throw new Error(`Target folder #${targetObject.parent}) not found`);

  const req = new CSiteRequest(webRequest, targetSite, targetFolder, targetObject, { contentObject, navObject });
  await req._prepareResponse();
  return req;
}

/** @deprecated WH5.7 moves to a simpler model base on the ResponseBuilder  */
export type SiteRequest = CSiteRequest;
export type ResponseBuilder = Omit<CSiteRequest, "_prepareResponse" | "_insertions" | "_frontendConfig">;

/* TODO establish the proper/stable approach with WHFSRequest. Eg open questions:
     - should we always return resolved objects (targetObject/targetFolder/...) or id ?
     - should we wrap Request objects during routing or should we just immediately create the proper object ?
*/

import { openFolder, openSite, whfsType, type Site, type WHFSFolder, type WHFSObject, type WHFSTypeName } from "@webhare/whfs";
import type { WebRequest } from "./request";
import { buildPluginData, getApplyTesterForObject, type WHFSApplyTester } from "@webhare/whfs/src/applytester";
import { runHareScriptPage, wrapHSWebdesign } from "./hswebdesigndriver";
import { importJSFunction, type Instance, type RichTextDocument } from "@webhare/services";
import { createWebResponse, getAssetPackIntegrationCode, type WebdesignPluginAPIs, type WebHareWHFSRouter, type WebResponse } from "@webhare/router";
import type { WHConfigScriptData } from "@webhare/frontend/src/init";
import { checkModuleScopedName } from "@webhare/services/src/naming";
import type { FrontendDataTypes } from "@webhare/frontend";
import { getExtractedConfig, getVersionInteger } from "@mod-system/js/internal/configuration";
import { dtapStage } from "@webhare/env";
import { isLitty, litty, littyToString, rawLitty, type Litty } from "@webhare/litty";
import type { InstanceData, WHFSTypes } from "@webhare/whfs/src/contenttypes";
import { getWHFSObjRef } from "@webhare/whfs/src/support";
import { stringify, throwError } from "@webhare/std";
import { type Insertable, type InsertPoints, type SiteResponse, SiteResponseSettings } from "./sitereponse";
import { renderRTD } from "@webhare/services/src/richdocument-rendering";

export type PluginInterface<API extends object> = {
  api: API;
};

/** @deprecated WH6.0 switches to PageBuilderFunction */
export type WebDesignFunction<T extends object> = (request: SiteRequest, settings: SiteResponseSettings) => Promise<SiteResponse<T>>;

export type PageBuilderFunction = (request: PageBuildRequest) => Promise<WebResponse>;

export type WidgetBuilderFunction = (request: PagePartRequest, data: InstanceData) => Promise<Litty>;

/** Defines the callback offered by a plugin (not exported from webhare/router yet, plugin APIs are still unstable) */
export type ResponseHookFunction<PluginDataType = Record<string, unknown>> = (req: PageBuildRequest, plugindata: PluginDataType) => Promise<void> | void;

type ContentPageRequestOptions = {
  statusCode?: number;
  contentObject?: WHFSObject;
};

export class CPageRequest {
  readonly webRequest: WebRequest | null;
  readonly targetObject: WHFSObject; //we could've gone for "WHFSFile | null" but then you'd *always* have to check for null. pointing to WHFSObject allows you to only check the real type sometimes
  /** The source of the content. private becaues we think users should be looking at */
  private readonly _contentObject: WHFSObject;
  readonly targetFolder: WHFSFolder;
  //mark webRoot as set, or we wouldn't be rendering a ContentPageRequest
  readonly targetSite: Site & { webRoot: string };

  //buildContentPageRequest will invoke _prepareResponse immediately to set these:
  protected _applyTester!: WHFSApplyTester;
  /** If we're publishing a content link, the link's apply tester. Otherwise identical to _applyTester */
  protected _contentApplyTester!: WHFSApplyTester;
  protected _siteLanguage!: string;
  protected _publicationSettings!: Awaited<ReturnType<WHFSApplyTester["getWebDesignInfo"]>>;
  private _statusCode: number;

  //TODO make private but hswebdesigndriver needs to be able to read the insertions to do its rendering
  __insertions: { [key in InsertPoints]?: Insertable[] } = {};

  /** JS configuration data */
  private frontendConfig: WHConfigScriptData;

  /** @deprecated use getInstance instead */
  get contentObject() {
    return this._contentObject;
  }
  get statusCode() {
    return this._statusCode;
  }

  constructor(webRequest: WebRequest | null, targetSite: Site, targetFolder: WHFSFolder, targetObject: WHFSObject, options?: ContentPageRequestOptions) {
    this.webRequest = webRequest;
    this.targetSite = targetSite as Site & { webRoot: string };
    this.targetFolder = targetFolder;
    this.targetObject = targetObject;
    this._contentObject = options?.contentObject || targetObject;
    this._statusCode = options?.statusCode || 200;

    this.frontendConfig = {
      siteRoot: this.targetSite.webRoot || "",
      site: {},
      obj: {},
      dtapStage: dtapStage,
      locale: "" as never,
      server: getVersionInteger() //TODO we intend to completely deprecate this. should never depend on server versions
    };
  }

  async _preparePageRequestBase() {
    this._applyTester = await getApplyTesterForObject(this.targetObject);
    this._contentApplyTester = this.targetObject.type === "platform:filetypes.contentlink" ? await getApplyTesterForObject(this._contentObject) : this._applyTester; //if we're a contentlink, we want to use the applytester of our target for things like rendering and getting frontend data, but we still want to keep track of the original content object for plugins and such
    this._siteLanguage = await this._applyTester.getSiteLanguage(); //FIXME we need to be in a CodeContext and set tid!
    this._publicationSettings = await this._applyTester.getWebDesignInfo();
  }

  get siteLanguage() {
    return this._siteLanguage;
  }

  /** Insert a callback for use during rendering */
  insertAt(where: InsertPoints, what: Insertable) {
    if (!this.__insertions[where])
      this.__insertions[where] = [];

    this.__insertions[where].push(what); //ensured above
  }

  /** Set data associated with a plugin */
  setFrontendData<Type extends keyof FrontendDataTypes>(dataObject: Type, data: FrontendDataTypes[Type]) {
    checkModuleScopedName(dataObject);
    this.frontendConfig[dataObject] = data;
  }

  //TODO do we like this name? or getInstanceData? or.. we don't have a TS name for it yet?
  async getInstance<const Type extends keyof WHFSTypes | string & {}>(type: string extends Type ? Type : WHFSTypeName): Promise<[Type] extends [WHFSTypeName] ? WHFSTypes[Type]["GetFormat"] : InstanceData> {
    return whfsType(type).get(this._contentObject.id);
  }

  /** Load the function that can actually generate pages for us */
  async getPageRenderer(): Promise<WebHareWHFSRouter | null> {
    //TODO rename 'renderer:' to 'buildPage:' ?  rename WebHareWHFSRouter although I see what it's doing there?
    const renderinfo = await this._contentApplyTester.getObjRenderInfo();
    if (renderinfo?.renderer) { //JS renderer is always preferred
      const renderer: WebHareWHFSRouter = await importJSFunction<WebHareWHFSRouter>(renderinfo.renderer);
      return renderer;
    }

    if (renderinfo.hsPageObjectType) {
      return (request: ContentPageRequest) => runHareScriptPage(request, { hsPageObjectType: renderinfo.hsPageObjectType });
    }

    if (renderinfo.dynamicExecution) {
      return (request: ContentPageRequest) => runHareScriptPage(request, { dynamicExecution: renderinfo.dynamicExecution! });
    }

    return null;
  }

  /** Render the given HTML using the proper pageBuilder call (aka WebDesign in HareScript)
   * @param page - Generated HTML to embed (generally into the `<main>` container of the page)
  */
  async buildWebPage(page: Litty): Promise<WebResponse> {
    //FIXME wrap with content-top/content-bottom insert points
    this._page = page;
    if (this._publicationSettings.objectName)
      return wrapHSWebdesign(this);

    if (!this._publicationSettings.pageBuilder) {
      if (this._publicationSettings.siteResponseFactory) {
        //legacy support for old-style SiteResponse factories, will be removed after WH6
        const factory = await importJSFunction<WebDesignFunction<object>>(this._publicationSettings.siteResponseFactory);
        const settings = new SiteResponseSettings;
        settings.assetpack = this._publicationSettings.assetPack;
        settings.witty = this._publicationSettings.witty;
        const assetPackInfo = getExtractedConfig("assetpacks").find(_ => _.name === this._publicationSettings.assetPack);
        settings.supportedlanguages = assetPackInfo?.supportedLanguages || [];
        settings.lang = this._siteLanguage;

        const response = await factory(this, settings);
        response.appendHTML(await littyToString(page));
        return await response.finish();
      }
      throw new Error(`buildWebPage is not available for webdesigns that have not switched to it yet`);
    }

    // Now that we're pretty sure we'll be generating HTML, initialize plugins
    for (const plugin of this._publicationSettings.plugins) {
      if (plugin.composer_hook) {
        const plugindata = buildPluginData(plugin.datas);
        await (await importJSFunction<ResponseHookFunction>(plugin.composer_hook))(this, plugindata);
      }
    }

    //TODO this is a bit of a hack to get the data for the new renderer
    const pageBuilder = await importJSFunction<PageBuilderFunction>(this._publicationSettings.pageBuilder);
    return pageBuilder(this);
  }

  /** @deprecated createComposer is going away after WH6 */
  async createComposer() {
    //only stub what we need for backwards compatibility
    let html = '';
    return {
      insertAt: (where: InsertPoints, what: Insertable) => {
        this.insertAt(where, what as Litty);
      },
      appendHTML: (data: string) => {
        html += data;
      },
      finish: async () => {
        return await this.buildWebPage(rawLitty(html));
      },
      setFrontendData: this.setFrontendData.bind(this),
    };
  }

  private _page?: Litty;
  get content(): Litty {
    return this._page ?? throwError("Page not set?");
  }

  plugins: {
    [Api in keyof WebdesignPluginAPIs]?: PluginInterface<WebdesignPluginAPIs[Api]>;
  } = {};

  //FIXME private but hswebdesigndriver needs to be able to read the insertions to do its rendering
  async __renderInserts(point: InsertPoints): Promise<Litty> {
    let output = '';
    for (const insert of this.__insertions[point] || []) {
      if (typeof insert === "string")
        output += insert;
      else if ("strings" in insert) //Litty
        output += await littyToString(insert);
      else
        output += await insert();
    }
    return rawLitty(output);
  }
  private async renderBodyFinale(): Promise<Litty> {
    return litty`
      ${this.__insertions["body-bottom"] ? await this.__renderInserts("body-bottom") : ''}
      ${

      //TODO
      // IF(RecordExists(this->consiliofields))
      // {
      //   //NOTE: we do not consider this format 'stable', format may change or maybe we try to store it outside the HTML itself
      //   Print(`<script type="application/x-hson" id="wh-consiliofields">${EncodeHSON(this->consiliofields)}</script>`);
      // }

      // IF (IsRequest() AND IsWHDebugOptionSet("win"))
      //   PrintInvokedWitties();
      //used by dev plugins to ensure they really run last and can catch any resources loaded by body-bottom
      ""}
        ${this.__insertions["body-devbottom"] ? await this.__renderInserts("body-devbottom") : ''}`;
  }


  private async buildPage(head: Litty, body: Litty, settings: SiteResponseSettings): Promise<Litty> {
    const assetpacksettings = getExtractedConfig("assetpacks").find(assetpack => assetpack.name === settings.assetpack);
    if (!assetpacksettings)
      throw new Error(`Settings for assetpack '${settings.assetpack}' not found`);

    return litty`<!DOCTYPE html>
<html lang="${settings.lang}"
      dir="${settings.htmldirection}"
      ${settings.htmlclasses ? litty`class="${settings.htmlclasses.join(" ")}"` : ''}
      ${Object.entries(settings.htmlprefixes).length ? litty`prefix="${Object.entries(settings.htmlprefixes).map(([prefix, namespace]) => `${prefix}: ${namespace}`).join(" ")}"` : ''}
      data-wh-ob="${getWHFSObjRef(this.targetObject)}">
  <head>
    <meta charset="utf-8">
    <title>${settings.pagetitle}</title>
    ${settings.pagedescription ? litty`<meta name="description" content="${settings.pagedescription}">` : ''}
    ${settings.canonicalurl ? litty`<link rel="canonical" href="${settings.canonicalurl}">` : ''}
    ${head}
    ${this.__insertions["dependencies-top"] ? await this.__renderInserts("dependencies-top") : ''}
    ${litty`<script type="application/json" id="wh-config">${stringify(this.frontendConfig, { target: "script", typed: true })}</script>`}
    ${    /* TODO cachebuster /! support
      IF(cachebuster !== "")
        bundlebaseurl := "/!" || EncodeURL(cachebuster) || bundlebaseurl;
    */

      rawLitty(getAssetPackIntegrationCode(settings.assetpack))}
    ${this.__insertions["dependencies-bottom"] ? await this.__renderInserts("dependencies-bottom") : ''}
    ${
      //FIXME
      // IF(Length(this->structuredbreadcrumb) > 0)
      //   this->__PrintStructuredData();

      //FIXME this->_PrintRobotTag();

      /*
              IF (this->pvt_renderwidgetpreview)
              {
                data.contents := this->__renderwidgetpreview;

                IF (this->pagewitty->HasComponent("htmlwidgetbody"))
                  this->pagewitty->RunComponent("htmlwidgetbody", data);
                ELSE
                  this->pagewitty->CallWithScope(data.contents, data);
              }
              ELSE
              {*/
      ''
      }
    </head>
    <body>
      ${this.__insertions["body-top"] ? await this.__renderInserts("body-top") : ''}
      ${body}
      ${await this.renderBodyFinale()}
    </body>
  </html>`;
  }

  /** Render our head&body into a full HTML page*/
  async render(content: {
    head: Litty;
    body: Litty;
  }): Promise<WebResponse> {
    const settings = new SiteResponseSettings;
    settings.assetpack = this._publicationSettings.assetPack;
    settings.witty = this._publicationSettings.witty;

    const assetPackInfo = getExtractedConfig("assetpacks").find(_ => _.name === this._publicationSettings.assetPack);
    settings.supportedlanguages = assetPackInfo?.supportedLanguages || [];
    settings.lang = this._siteLanguage;

    const final = await this.buildPage(content.head, content.body, settings);
    return createWebResponse(await littyToString(final), {
      status: this.statusCode
    });
  }

  getPlugin<PluginType extends keyof WebdesignPluginAPIs>(api: PluginType): WebdesignPluginAPIs[PluginType] | null {
    return this.plugins[api]?.api || null;
  }

  addPlugin<PluginType extends keyof WebdesignPluginAPIs>(api: PluginType, plugin: WebdesignPluginAPIs[PluginType]) {
    this.plugins[api] = { api: plugin };
  }

  async renderRTD(rtd: RichTextDocument): Promise<Litty> {
    //FIXME need an equivalent for overriding RTD rendering. HareScript does webdesign->rtd_rendering_engine BUT in TS we won't have the webdesign yet during pagerendering. So applytester needs to ship it
    const parsedWith = this._publicationSettings.maxContentWidth.match(/^(\d+)px$/);
    const maxImageWidth = parsedWith ? parseInt(parsedWith[1]) : undefined;
    return renderRTD(this, rtd, { maxImageWidth });
  }

  //FIXME need a better match for the widget type
  async renderWidget(widget: Pick<Instance, "whfsType" | "data">): Promise<Litty> {
    const renderer = await this._applyTester.getWidgetSettings(widget.whfsType);
    if (!renderer.renderJS) {
      if (renderer.renderHS)
        throw new Error(`Widget ${widget.whfsType} has a HS renderer but no JS renderer, and cannot be rendered in this context`);
      throw new Error(`Widget ${widget.whfsType} does not have a renderer and cannot be rendered`);
    }

    const renderFunction = await importJSFunction<WidgetBuilderFunction>(renderer.renderJS);
    //TODO give a minimized interface/proxy as widgets are known to be eager to reach into other details
    const result = await renderFunction(this, widget.data);
    if (!isLitty(result))
      throw new Error(`Widget renderer '${renderer.renderJS}' failed to return a proper Litty template`);
    return result;
  }
}

export async function buildContentPageRequest(webRequest: WebRequest | null, targetObject: WHFSObject, options?: ContentPageRequestOptions): Promise<ContentPageRequest> {
  if (!targetObject.parentSite)
    throw new Error(`Target '${targetObject.whfsPath}' (#${targetObject.id}) is not in a site`);

  const targetSite = await openSite(targetObject.parentSite);
  const targetFolder = targetObject.isFolder ? targetObject as WHFSFolder : targetObject.parent ? await openFolder(targetObject.parent) : null; //parent must exist if we're in a site.
  if (!targetFolder)
    throw new Error(`Target folder #${targetObject.parent}) not found`);

  const req = new CPageRequest(webRequest, targetSite, targetFolder, targetObject, options);
  await req._preparePageRequestBase();
  return req;
}

export type PagePartRequest = Pick<CPageRequest, "renderRTD" | "renderWidget">;
type PageRequestBase = PagePartRequest & Pick<CPageRequest, "targetFolder" | "targetObject" | "setFrontendData" | "targetSite" | "insertAt" | "siteLanguage" | "webRequest" | "getInstance">;
export type ContentPageRequest = PageRequestBase & Pick<CPageRequest, "buildWebPage" | "getPageRenderer">;
// Plugin API is only visible during PageBuildRequest as we don't want to initialize them it during the page run itself. eg. might still redirect
export type PageBuildRequest = PageRequestBase & Pick<CPageRequest, "render" | "getPlugin" | "addPlugin" | "content">;

/** @deprecated SiteRequest will be removed after WH6 */
export type SiteRequest = Pick<CPageRequest, "createComposer" | "contentObject" | "targetSite" | "targetObject" | "targetFolder" | "webRequest">;

/** @deprecated ResponseBuilder experiment failed. Replace with SiteRequest  */
export type ResponseBuilder = Omit<PageBuildRequest, "_prepareResponse" | "_insertions" | "_frontendConfig">;

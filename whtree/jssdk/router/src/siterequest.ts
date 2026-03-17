/* TODO establish the proper/stable approach with WHFSRequest. Eg open questions:
     - should we always return resolved objects (targetObject/targetFolder/...) or id ?
     - should we wrap Request objects during routing or should we just immediately create the proper object ?
*/

import { describeWHFSType, openFileOrFolder, openFolder, openSite, whfsType, type Site, type WHFSFolder, type WHFSObject, type WHFSTypeName } from "@webhare/whfs";
import type { WebRequest } from "./request";
import { buildPluginData, getApplyTesterForObject, type WHFSApplyTester } from "@webhare/whfs/src/applytester";
import { renderHSWidget, runHareScriptPage, wrapHSWebdesign } from "./hswebdesigndriver";
import { importJSFunction, type RichTextDocument } from "@webhare/services";
import { createWebResponse, getAssetPackIntegrationCode, type WebdesignPluginAPIs, type WebResponse } from "@webhare/router";
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
import { PageMetaData } from "./metadata";
import { dbLoc } from "@webhare/services/src/symbols";
import type { WebHareDBLocation } from "@webhare/services/src/descriptor";

export type PluginInterface<API extends object> = {
  api: API;
};

/** @deprecated WH6.0 switches to PageBuilderFunction */
export type WebDesignFunction<T extends object> = (request: SiteRequest, settings: SiteResponseSettings) => Promise<SiteResponse<T>>;

export type ContentBuilderFunction = (request: ContentPageRequest) => Promise<WebResponse>;

export type PageBuilderFunction = (request: PageBuildRequest) => Promise<WebResponse>;

export type WidgetBuilderFunction = (request: PagePartRequest, data: InstanceData) => Promise<Litty>;

/** Defines the callback offered by a plugin (not exported from webhare/router yet, plugin APIs are still unstable) */
export type PagePluginFunction<PluginDataType = Record<string, unknown>> = (req: PagePluginRequest, plugindata: PluginDataType) => Promise<void> | void;

type ContentPageRequestOptions = {
  statusCode?: number;
  contentObject?: WHFSObject;
};

/** Convert a camelCaseName to corresponding kebab-case-name
 * @param name - Name to convert
 * @returns Converted name
*/
function nameToKebabCase(name: string) {
  return name.replaceAll(/[A-Z]/g, c => '-' + c.toLowerCase());
}

/** Type of targetPath entries */
export type TargetPathEntry = {
  /** The WHFS object ID */
  id: number;
  /** The name of the object id */
  name: string;
  /** TThe title of the object */
  title: string;
  /** Link to the object, if published */
  link: string | null;
};

// Build a path to a targetObject
export async function buildTargetPath(targetObject: WHFSObject) {
  const targetPath: TargetPathEntry[] = [];
  //TODO more efficient DB query, have DB help? And probably @webhare/whfs should be offering APIs for building trees
  for (let item: WHFSObject | null = targetObject; item; item = item.parent ? await openFileOrFolder(item.parent) : null) {
    targetPath.unshift({ id: item.id, name: item.name, title: item.title, link: item.link });
    if (item.id === targetObject.parentSite)
      break; //found site root
  }
  return targetPath;
}

export class CPageRequest {
  readonly webRequest: WebRequest | null;
  readonly targetObject: WHFSObject; //we could've gone for "WHFSFile | null" but then you'd *always* have to check for null. pointing to WHFSObject allows you to only check the real type sometimes
  /** The source of the content. private because we think users shouldn't be looking at it */
  private readonly _contentObject: WHFSObject;
  readonly targetFolder: WHFSFolder;
  //mark webRoot as set, or we wouldn't be rendering a ContentPageRequest
  readonly targetSite: Site & { webRoot: string };

  /** The navigation path entries from the site root to the current targetObject */
  targetPath: Array<TargetPathEntry> = [];

  readonly pageMetaData = new PageMetaData();

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

    //initialize the page metadata before returning the rendering function
    this.pageMetaData.title = this._contentObject.title || this.targetFolder.title;
    const seoSettings = {
      ...await this.getInstance("platform:web.config"),
      ...await this.getInstance("platform:web.metadata"),
    };
    if (!this.targetObject.isFolder && seoSettings?.seoTitle)
      this.pageMetaData.title = seoSettings.seoTitle;
    if (!this.pageMetaData.title && this.targetFolder.id !== this.targetFolder.parentSite) // Try the site root folder's title
      this.pageMetaData.title = (await openFolder(this.targetSite.id)).title;
    if (!this.pageMetaData.title) // Still no title
      this.pageMetaData.title = this.targetSite.name;
    this.pageMetaData.description = this.targetObject.description; //No fallback to folder. a folder's description is unlikely to apply to a file?
    if (this.targetObject.isFile)
      this.pageMetaData.keywords = this.targetObject.keywords;

    if (seoSettings.canonical) {
      const canonicalTarget = (await openFileOrFolder(seoSettings.canonical, { allowMissing: true }))?.link;
      if (canonicalTarget)
        this.pageMetaData.canonicalUrl = canonicalTarget;
    }
    //TODO The form filetype should deal with this instead of hardcoding a type reference here
    if (!this.pageMetaData.canonicalUrl && (!this.webRequest || this.targetObject.type === "platform:filetypes.form"))
      this.pageMetaData.canonicalUrl = this.targetObject.link;

    // Build path to the target. We'll need it to initialize the breadcrumb and inital SEO settings
    this.targetPath.push(...await buildTargetPath(this.targetObject));

    // Initialize robots tag
    const seoItems = (await whfsType("platform:web.config").enrich(this.targetPath.slice(0, this.targetPath.length - 1), "id", ["noIndex", "noFollow", "noArchive", "customRobots", "canonical"]));
    for (const seoItem of [...seoItems, seoSettings]) {
      if (seoItem.noIndex)
        this.pageMetaData.robotsTag.noIndex = true;
      if (seoItem.noFollow)
        this.pageMetaData.robotsTag.noFollow = true;
      if (seoItem.noArchive)
        this.pageMetaData.robotsTag.noArchive = true;
      if (seoItem.customRobots)
        this.pageMetaData.robotsTag.custom = seoItem.customRobots;
    }
    const baseProps = await this._applyTester.getBaseProperties();
    if (baseProps.noindex)
      this.pageMetaData.robotsTag.noIndex = true;
    if (baseProps.nofollow)
      this.pageMetaData.robotsTag.noFollow = true;
    if (baseProps.noarchive)
      this.pageMetaData.robotsTag.noArchive = true;

    // Initialize the breadcrumb
    const breadcrumb = this.pageMetaData.breadcrumb;
    for (const pathEntry of this.targetPath) {
      breadcrumb.push({
        "@type": "ListItem",
        url: pathEntry.link || undefined,
        name: pathEntry.title || pathEntry.name || undefined,
      });
    }
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
  async getPageRenderer(): Promise<ContentBuilderFunction> {
    //TODO rename 'renderer:' to 'buildPage:' ?  rename ContentBuilderFunction although I see what it's doing there?
    const renderinfo = await this._contentApplyTester.getObjRenderInfo();
    if (renderinfo?.contentBuilder) { //JS renderer is always preferred
      const renderer: ContentBuilderFunction = await importJSFunction<ContentBuilderFunction>(renderinfo.contentBuilder);
      return renderer;
    }

    if (renderinfo.hsPageObjectType) {
      return (request: ContentPageRequest) => runHareScriptPage(request, { hsPageObjectType: renderinfo.hsPageObjectType });
    }

    if (renderinfo.dynamicExecution) {
      return (request: ContentPageRequest) => runHareScriptPage(request, { dynamicExecution: renderinfo.dynamicExecution! });
    }

    const typeInfo = await describeWHFSType(this._contentApplyTester.type);
    if (typeInfo?.metaType === "widgetType") { //a widget can be rendered as a HTML fragment
      return async (_request: ContentPageRequest) => {
        const data = await whfsType(this._contentApplyTester.type).get(this._contentObject.id);
        const widget = await this.renderWidget({ whfsType: this._contentApplyTester.type, data });
        this.pageMetaData.htmlClasses.push('wh-widgetpreview');
        return this.render({ body: widget });
      };
    }

    //It's possible a filetype has no renderer at all.. the webdesign may handle it by itself based on type id (often done for contentlistings)
    return (request: ContentPageRequest) => request.buildWebPage(litty``);
  }

  /** Render the given HTML using the proper pageBuilder call (aka WebDesign in HareScript)
   * @param page - Generated HTML to embed (generally into the `<main>` container of the page)
  */
  async buildWebPage(page: Litty): Promise<WebResponse> {
    //FIXME wrap with content-top/content-bottom insert points
    this._page = page;
    if (this._publicationSettings.objectName)
      return wrapHSWebdesign(this);

    // Now that we're pretty sure we'll be generating HTML, initialize plugins
    for (const plugin of this._publicationSettings.plugins) {
      if (plugin.composer_hook) {
        const plugindata = buildPluginData(plugin.datas);
        await (await importJSFunction<PagePluginFunction>(plugin.composer_hook))(this, plugindata);
      }
    }

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

  private renderRobotsTag() {
    const tagParts: string[] = [];
    for (const usualProp of ["noIndex", "noFollow", "noArchive", "noImageIndex", "noSnippet"])
      if (this.pageMetaData.robotsTag[usualProp as keyof typeof this.pageMetaData.robotsTag])
        tagParts.push(usualProp.toLowerCase());

    if (this.pageMetaData.robotsTag.noIndex && !this.pageMetaData.robotsTag.noFollow)
      tagParts.push("follow"); //various sources seem to recommend explicitly setting follow/nofollow after a noindex, and it shouldn't do harm

    if (this.pageMetaData.robotsTag.unavailableAfter)
      tagParts.push("unavailable_after:" + this.pageMetaData.robotsTag.unavailableAfter.toZonedDateTimeISO("UTC").toString({
        calendarName: "never",
        smallestUnit: "second",
        timeZoneName: "never",
        offset: "never",
      }));

    if (this.pageMetaData.robotsTag.custom)
      tagParts.push(this.pageMetaData.robotsTag.custom);

    const tag = tagParts.join(",");
    if (tag)
      return litty`<meta name="robots" content="${tag}">`;
    return '';
  }

  private getFinalStructuredData() {
    return this.pageMetaData.structuredData.map(item => ({
      "@context": "https://schema.org",
      ...item
    }));
  }

  private async renderBodyFinale(): Promise<Litty> {
    const schemaOrgItems = this.getFinalStructuredData();
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
        ${this.__insertions["body-devbottom"] ? await this.__renderInserts("body-devbottom") : ''}
        <script type="application/ld+json">${rawLitty(stringify(schemaOrgItems, { target: "script" }))}</script>`;
  }

  private async buildPage(head: Litty | undefined, body: Litty, settings: SiteResponseSettings): Promise<Litty> {
    const assetpacksettings = getExtractedConfig("assetpacks").find(assetpack => assetpack.name === settings.assetpack);
    if (!assetpacksettings)
      throw new Error(`Settings for assetpack '${settings.assetpack}' not found`);

    return litty`<!DOCTYPE html>
<html lang="${settings.lang}"
      dir="${this.pageMetaData.htmlDirection}"
      ${this.pageMetaData.htmlClasses ? litty`class="${this.pageMetaData.htmlClasses.join(" ")}"` : ''}
      ${this.pageMetaData.htmlPrefixes.length ? litty`prefix="${this.pageMetaData.htmlPrefixes.map(([prefix, namespace]) => `${prefix}: ${namespace}`).join(" ")}"` : ''}
      ${Object.entries(this.pageMetaData.htmlDataSet).length ? Object.entries(this.pageMetaData.htmlDataSet).map(([key, value]) => litty`data-${nameToKebabCase(key)}="${value}" `) : ''}
      data-wh-ob="${getWHFSObjRef(this.targetObject)}">
  <head>
    <meta charset="utf-8">
    <title>${this.pageMetaData.title}</title>
    ${this.pageMetaData.viewport ? litty`<meta name="viewport" content="${this.pageMetaData.viewport}">` : ''}
    ${this.pageMetaData.description ? litty`<meta name="description" content="${this.pageMetaData.description}">` : ''}
    ${this.pageMetaData.keywords ? litty`<meta name="keywords" content="${this.pageMetaData.keywords}">` : ''}
    ${this.pageMetaData.canonicalUrl ? litty`<link rel="canonical" href="${this.pageMetaData.canonicalUrl}">` : ''}
    ${head ?? ''}
    ${this.__insertions["dependencies-top"] ? await this.__renderInserts("dependencies-top") : ''}
    ${litty`<script type="application/json" id="wh-config">${rawLitty(stringify(this.frontendConfig, { target: "script", typed: true }))}</script>`}
    ${    /* TODO cachebuster /! support
      IF(cachebuster !== "")
        bundlebaseurl := "/!" || EncodeURL(cachebuster) || bundlebaseurl;
    */

      rawLitty(getAssetPackIntegrationCode(settings.assetpack))}
    ${this.__insertions["dependencies-bottom"] ? await this.__renderInserts("dependencies-bottom") : ''}
    ${this.renderRobotsTag()}
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
    head?: Litty;
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
  async renderWidget(widget: { whfsType: string; data: InstanceData;[dbLoc]?: WebHareDBLocation | null }): Promise<Litty> {
    const renderer = await this._applyTester.getWidgetSettings(widget.whfsType);
    if (!renderer.renderJS) {
      if (renderer.renderHS) {
        if (!(widget[dbLoc]?.source === 2 || widget[dbLoc]?.source === 1))
          throw new Error(`Widget ${widget.whfsType} has a HS renderer but no JS renderer and is not sourced from a database, so we can't render it`);

        const result = await renderHSWidget(this, widget.whfsType, widget[dbLoc]);
        return result.content;
      }
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

//How well can we isolate widgets (PagePartRequest users) in practice? ideally we won't provide APIs that can cause 2 widgets to conflict with each other
export type PagePartRequest = Pick<CPageRequest, "renderRTD" | "renderWidget" | "targetFolder" | "targetObject" | "targetSite" | "targetPath" | "siteLanguage">;
type PageRequestBase = PagePartRequest & Pick<CPageRequest, "setFrontendData" | "insertAt" | "webRequest" | "getInstance" | "pageMetaData">;
export type ContentPageRequest = PageRequestBase & Pick<CPageRequest, "buildWebPage" | "getPageRenderer">;
// Plugin API is only visible during PageBuildRequest as we don't want to initialize them it during the page run itself. eg. might still redirect
export type PageBuildRequest = PageRequestBase & Pick<CPageRequest, "render" | "getPlugin" | "addPlugin" | "content">;

export type PagePluginRequest = PageRequestBase & Pick<CPageRequest, "getPlugin" | "addPlugin">;

/** @deprecated SiteRequest will be removed after WH6 */
export type SiteRequest = Pick<CPageRequest, "createComposer" | "contentObject" | "targetSite" | "targetObject" | "targetFolder" | "webRequest">;

/** @deprecated ResponseBuilder experiment failed. Replace with SiteRequest  */
export type ResponseBuilder = Omit<PageBuildRequest, "_prepareResponse" | "_insertions" | "_frontendConfig">;

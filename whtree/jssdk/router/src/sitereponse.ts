import type { WHConfigScriptData } from "@webhare/frontend/src/init";
import { createWebResponse, WebResponse } from "./response";
import type { SiteRequest } from "./siterequest";
import * as services from "@webhare/services";
import { encodeString, stringify } from "@webhare/std";
import { getExtractedConfig, getVersionInteger } from "@mod-system/js/internal/configuration";
import { getAssetPackBase } from "@mod-platform/js/concepts/frontend";

export class SiteResponseSettings {
  assetpack: string = '';
  witty: string = '';
  lang: string = 'en';
  htmlclasses: string[] = [];
  htmlprefixes: Record<string, string> = {};
  htmldirection: "ltr" | "rtl" = "ltr";
  htmldataset: Record<string, string> = {};
  pagetitle: string = '';
  pagedescription: string | null = null;
  canonicalurl: string | null = null;
  supportedlanguages: string[] = [];
}

export type InsertPoints = "dependencies-top" | "dependencies-bottom" | "content-top" | "content-bottom" | "body-top" | "body-bottom" | "body-devbottom";

type Insertable = string | (() => string | Promise<string>);

function getDesignRootForAssetPack(assetpack: string): string {
  //Transform an assetpackname, eg 'webhare_testsuite:basetestjs' to its corresponding URL, '/.publisher/sd/webhare_testsuite/basetestjs/'
  return `/.publisher/sd/${assetpack.replace(":", "/")}/`;
}

function encodeAttr(s: string): string {
  return encodeString(s, "attribute");
}

export function getAssetPackIntegrationCode(assetpack: string, { designRoot = '', cacheBuster = '' } = {}) {
  let scriptsettings = '';
  if (designRoot !== "")
    scriptsettings += ' crossorigin="anonymous"';
  scriptsettings += ' async type="module"';

  let bundleBaseUrl = getAssetPackBase(assetpack);
  if (cacheBuster)
    bundleBaseUrl = "/!" + encodeURIComponent(cacheBuster) + bundleBaseUrl;
  if (designRoot)
    bundleBaseUrl = new URL(designRoot, bundleBaseUrl).toString();

  return `<link rel="stylesheet" href="${encodeAttr(bundleBaseUrl)}ap.css">`
    + `<script src="${encodeAttr(bundleBaseUrl)}ap.mjs"${scriptsettings}></script>`;
}

/** SiteResponse implements HTML pages rendered using site configuration from WHFS and site profiles */
export class SiteResponse<T extends object = object> {
  siteRequest: SiteRequest;
  settings: SiteResponseSettings;
  protected contents = "";
  private rendering = false;
  protected insertions: Partial<Record<InsertPoints, Insertable[]>> = {};

  /** The pageConfig. Not protected because we assume that if you know it's type T, its on you if you access it */
  pageConfig: T;

  /** JS configuration data */
  private frontendConfig: WHConfigScriptData;

  constructor(pageConfig: T, siteRequest: SiteRequest, settings: SiteResponseSettings) {
    this.siteRequest = siteRequest;
    this.pageConfig = pageConfig;
    this.settings = settings;

    this.frontendConfig = {
      siteRoot: "",
      site: {},
      obj: {},
      dtapStage: services.backendConfig.dtapstage,
      locale: this.settings.lang as never, //why doesn't JS just get the html lang= ?
      server: getVersionInteger() //TODO we intend to completely deprecate this. should never depend on server versions
    };
  }

  /** Render the contents of the specified witty component (path#component) with the specified data
    Using path:component is a syntax error and will throw if detected
    Resolves when completed. If you're not waiting, don't modify dataobject and any contained objects until the Witty has completed running! */
  //  async addWitty(wittycomponent: string, dataobject?: unknown);

  /** Append the specified text */
  appendHTML(text: string) {
    this.contents += text;
  }

  /** Set data associated with a plugin */
  setPluginConfig(pluginname: string, data: object | null) { //HareScript: WebDesignBase::SetJSPluginConfig
    if (data)
      this.frontendConfig[pluginname] = data;
    else
      delete this.frontendConfig[pluginname];
  }

  private async generatePage(head: string, body: string, urlpointers: { designroot: string; designcdnroot: string; imgroot: string; siteroot: string }) {
    let page = `<!DOCTYPE html>\n<html lang="${encodeAttr(this.settings.lang)}" dir="${encodeAttr(this.settings.htmldirection)}"`;
    if (this.settings.htmlclasses.length)
      page += ` class="${encodeAttr(this.settings.htmlclasses.join(" "))}"`;
    if (Object.entries(this.settings.htmlprefixes).length)
      page += ` prefix="${encodeAttr(Object.entries(this.settings.htmlprefixes).map(([prefix, namespace]) => `${prefix}: ${namespace}`).join(" "))}"`;
    //FIXME add html dataset, camelcase it
    page += "><head>";
    page += "<meta charset=\"utf-8\">";
    page += `<title>${encodeAttr(this.settings.pagetitle)}</title>`;
    if (this.settings.pagedescription)
      page += `<meta name="description" content="${encodeAttr(this.settings.pagedescription)}">`;
    if (this.settings.canonicalurl)
      page += `<link rel="canonical" href="${encodeAttr(this.settings.canonicalurl)}">`;
    page += head;

    //TODO do we (still) need all these roots?
    this.frontendConfig.siteRoot = urlpointers.siteroot;

    if (this.insertions["dependencies-top"])
      page += await this.renderInserts("dependencies-top");

    page += `<script type="application/json" id="wh-config">${stringify(this.frontendConfig, { target: "script" })}</script>`;

    //FIXME adhoc bundle support
    /* TODO cachebuster /! support
      IF(cachebuster !== "")
        bundlebaseurl := "/!" || EncodeURL(cachebuster) || bundlebaseurl;
    */
    const assetpacksettings = getExtractedConfig("assetpacks").find(assetpack => assetpack.name === this.settings.assetpack);
    if (!assetpacksettings)
      throw new Error(`Settings for assetpack '${this.settings.assetpack}' not found`);
    page += getAssetPackIntegrationCode(this.settings.assetpack);


    if (this.insertions["dependencies-bottom"])
      page += await this.renderInserts("dependencies-bottom");
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

    page += "</head><body>";
    //TODO do we still want body classes? html classes are always a better idea in the end..
    if (this.insertions["body-top"])
      page += await this.renderInserts("body-top");
    page += body;
    page += await this.renderBodyFinale();
    page += "</body></html>";
    return page;
  }

  private async renderBodyFinale() {
    let page = '';
    if (this.insertions["body-bottom"])
      page += await this.renderInserts("body-bottom");

    //TODO
    // IF(RecordExists(this->consiliofields))
    // {
    //   //NOTE: we do not consider this format 'stable', format may change or maybe we try to store it outside the HTML itself
    //   Print(`<script type="application/x-hson" id="wh-consiliofields">${EncodeHSON(this->consiliofields)}</script>`);
    // }

    // IF (IsRequest() AND IsWHDebugOptionSet("win"))
    //   PrintInvokedWitties();
    //used by dev plugins to ensure they really run last and can catch any resources loaded by body-bottom

    if (this.insertions["body-devbottom"])
      page += await this.renderInserts("body-devbottom");

    return page;
  }

  protected async renderInserts(point: InsertPoints) {
    let output = '';
    for (const insert of this.insertions[point]!) {
      if (typeof insert === "string")
        output += insert;
      else
        output += await insert();
    }
    return output;
  }

  getSupportedLanguages(): Record<string, boolean> {
    return Object.fromEntries(this.settings.supportedlanguages.map(lang => [lang, false]));
  }

  /** Insert a callback for use during rendering */
  insertAt(where: InsertPoints, what: Insertable) {
    if (this.rendering)
      throw new Error("Cannot insert after rendering has started");
    if (!this.insertions[where])
      this.insertions[where] = [];
    this.insertions[where]!.push(what); //ensured above
  }

  private async getContents(): Promise<string> {
    let contents = '';
    if (this.insertions["content-top"])
      contents += await this.renderInserts("content-top");
    contents += this.contents;
    if (this.insertions["content-bottom"])
      contents += await this.renderInserts("content-bottom");
    return contents;
  }

  async finish(): Promise<WebResponse> {
    const mywitty = await services.loadWittyResource(this.settings.witty); //TODO check/handle errors? or Will It Throw?
    const designroot = getDesignRootForAssetPack(this.settings.assetpack);
    const urlpointers = {
      designroot,
      designcdnroot: designroot, //FIXME
      imgroot: designroot + "img/",
      siteroot: this.siteRequest.targetSite.webRoot
    };
    const wittydata = {
      //FIXME base on the supported languages or just assume we're going to build a cool proxy
      sitelanguage: this.getSupportedLanguages(),
      //TODO use from CDN if so configured. or should we move it under /.wh/?
      ishomepage: this.siteRequest.targetObject.id === this.siteRequest.targetFolder.indexDoc && this.siteRequest.targetFolder.id === this.siteRequest.targetSite.id,
      ...urlpointers,
      ...this.pageConfig,
      contents: async () => this.getContents()
    };

    this.rendering = true;
    const head = mywitty.hasComponent("htmlhead") ? await mywitty.runComponent('htmlhead', wittydata) : "";
    const body = mywitty.hasComponent("htmlbody") ? await mywitty.runComponent('htmlbody', wittydata) : this.contents;
    const page = await this.generatePage(head, body, urlpointers);
    return createWebResponse(page);
  }
}

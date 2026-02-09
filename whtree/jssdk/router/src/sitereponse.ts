import type { WebResponse } from "./response";
import * as services from "@webhare/services";
import { throwError } from "@webhare/std";
import type { FrontendDataTypes } from "@webhare/frontend";
import type { PageBuildRequest, SiteRequest, WebdesignPluginAPIs } from "@webhare/router";
import { littyToString, rawLitty, type Litty } from "@webhare/litty";

export type PluginInterface<API extends object> = {
  api: API;
};

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
  #plugins: {
    [Api in keyof WebdesignPluginAPIs]?: PluginInterface<WebdesignPluginAPIs[Api]>;
  } = {};

  constructor() {

  }

  getPlugin<PluginType extends keyof WebdesignPluginAPIs>(api: PluginType): WebdesignPluginAPIs[PluginType] | null {
    return this.#plugins[api]?.api || null;
  }

  addPlugin<PluginType extends keyof WebdesignPluginAPIs>(api: PluginType, plugin: WebdesignPluginAPIs[PluginType]) {
    this.#plugins[api] = { api: plugin };
  }
}

export type InsertPoints = "dependencies-top" | "dependencies-bottom" | "content-top" | "content-bottom" | "body-top" | "body-bottom" | "body-devbottom";

//FIXME reduce to just Litty
export type Insertable = string | (() => string | Promise<string>) | Litty;

function getDesignRootForAssetPack(assetpack: string): string {
  //Transform an assetpackname, eg 'webhare_testsuite:basetestjs' to its corresponding URL, '/.publisher/sd/webhare_testsuite/basetestjs/'
  return `/.publisher/sd/${assetpack.replace(":", "/")}/`;
}

/** @deprecated WH6.0 will drop this in favor of pageBuilder: */
export class SiteResponse<T extends object = object> {
  siteRequest: SiteRequest;
  settings: SiteResponseSettings;
  protected contents = "";
  private rendering = false;
  private renderPageRequest: PageBuildRequest;

  /** The pageConfig. Not protected because we assume that if you know it's type T, its on you if you access it */
  pageConfig: T;

  constructor(pageConfig: T, siteRequest: SiteRequest, settings: SiteResponseSettings) {
    this.siteRequest = siteRequest;
    this.renderPageRequest = siteRequest as unknown as PageBuildRequest; //we know it's actually this
    this.pageConfig = pageConfig;
    this.settings = settings;
  }

  /** Append the specified text */
  appendHTML(text: string) {
    this.contents += text;
  }

  /** Set data associated with a plugin */
  setFrontendData<Type extends keyof FrontendDataTypes>(dataObject: Type, data: FrontendDataTypes[Type]) {
    this.renderPageRequest.setFrontendData(dataObject, data);
  }

  getSupportedLanguages(): Record<string, boolean> {
    return Object.fromEntries(this.settings.supportedlanguages.map(lang => [lang, false]));
  }

  /** Insert a callback for use during rendering */
  insertAt(where: InsertPoints, what: Insertable) {
    if (this.rendering)
      throw new Error("Cannot insert after rendering has started"); //TODO should ResponseBUilder do this check or can it mostly avoid rendering phase?
    this.renderPageRequest.insertAt(where, what);
  }

  private async getContents(): Promise<string> {
    return await littyToString(this.renderPageRequest.content);
  }

  async finish(): Promise<WebResponse> {
    const mywitty = await services.loadWittyResource(this.settings.witty); //TODO check/handle errors? or Will It Throw?
    const designroot = getDesignRootForAssetPack(this.settings.assetpack);
    const urlpointers = {
      designroot,
      designcdnroot: designroot, //FIXME
      imgroot: designroot + "img/",
      siteroot: this.siteRequest.targetSite.webRoot ?? throwError("No webroot for publication?")
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
    return await this.renderPageRequest.render({ head: rawLitty(head), body: rawLitty(body) });
  }
}

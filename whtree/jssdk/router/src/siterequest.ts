/* TODO establish the proper/stable approach with WHFSRequest. Eg open questions:
     - should we always return resolved objects (targetObject/targetFolder/...) or id ?
     - should we wrap Request objects during routing or should we just immediately create the proper object ?
*/

import { openFolder, openSite, type Site, type WHFSFolder, type WHFSObject } from "@webhare/whfs";
import { type SiteResponse, SiteResponseSettings } from "./sitereponse";
import type { WebRequest } from "./request";
import { buildPluginData, getApplyTesterForObject, type WHFSApplyTester } from "@webhare/whfs/src/applytester";
import { wrapHSWebdesign } from "./hswebdesigndriver";
import { loadJSFunction } from "@webhare/services";

export type WebDesignFunction<T extends object> = (request: SiteRequest, settings: SiteResponseSettings) => Promise<SiteResponse<T>>;
export type ComposerHookFunction<PluginDataType = Record<string, unknown>, T extends object = object> = (plugindata: PluginDataType, composer: SiteResponse<T>) => Promise<void> | void;

class SiteRequest {
  readonly webRequest: WebRequest;
  readonly targetObject: WHFSObject; //we could've gone for "WHFSFile | null" but then you'd *always* have to check for null. pointing to WHFSObject allows you to only check the real type sometimes
  readonly targetFolder: WHFSFolder;
  readonly targetSite: Site;
  readonly contentObject: WHFSObject;
  readonly navObject: WHFSObject;

  #applyTester?: WHFSApplyTester;
  #siteLanguage?: string;

  constructor(webRequest: WebRequest, targetSite: Site, targetFolder: WHFSFolder, targetObject: WHFSObject, { contentObject, navObject }: { contentObject?: WHFSObject; navObject?: WHFSObject } = {}) {
    this.webRequest = webRequest;
    this.targetSite = targetSite;
    this.targetFolder = targetFolder;
    this.targetObject = targetObject;
    this.contentObject = contentObject ?? targetObject;
    this.navObject = navObject ?? targetObject;
  }

  async getSiteLanguage(): Promise<string> {
    if (!this.#applyTester)
      this.#applyTester = await getApplyTesterForObject(this.targetObject);
    if (this.#siteLanguage === undefined)
      this.#siteLanguage = await this.#applyTester.getSiteLanguage();
    return this.#siteLanguage;
  }

  async createComposer<T extends object = object>(options?: { __captureJSDesign?: boolean }): Promise<SiteResponse<T>> { //async because we may delay loading the actual webdesign code until this point
    const lang = await this.getSiteLanguage(); //Also sets #applytester
    const publicationsettings = await this.#applyTester!.getWebDesignInfo();
    if (!publicationsettings.siteResponseFactory) {
      if (options?.__captureJSDesign) //prevent endless loop
        throw new Error(`Inconsistent siteprofiles - createComposer for ${this.targetObject.whfsPath} (#${this.targetObject.id}) wants to invoke a HS design but was invoked by captureJSDesign`);
      return wrapHSWebdesign<T>(this);
    }

    //FIXME - we need to fill in some more data based on the site profile
    const settings = new SiteResponseSettings;
    settings.assetpack = publicationsettings.assetPack;
    settings.witty = publicationsettings.witty;
    settings.supportedlanguages = publicationsettings.supportedLanguages;
    settings.lang = lang;

    const factory = await loadJSFunction<WebDesignFunction<T>>(publicationsettings.siteResponseFactory);
    const composer = await factory(this, settings);

    for (const plugin of publicationsettings.plugins) //apply plugins
      if (plugin.composerhook) {
        const plugindata = buildPluginData(plugin.datas);
        await (await loadJSFunction<ComposerHookFunction>(plugin.composerhook))(plugindata, composer);
      }

    return composer;
  }
}

export async function buildSiteRequest(webRequest: WebRequest, targetObject: WHFSObject, { contentObject, navObject }: { contentObject?: WHFSObject; navObject?: WHFSObject } = {}): Promise<SiteRequest> {
  if (!targetObject.parentSite)
    throw new Error(`Target '${targetObject.whfsPath}' (#${targetObject.id}) is not in a site`);

  const targetSite = await openSite(targetObject.parentSite);
  const targetFolder = targetObject.isFolder ? targetObject as WHFSFolder : await openFolder(targetObject.parent!); //parent must exist if we're in a site.
  return new SiteRequest(webRequest, targetSite, targetFolder, targetObject, { contentObject, navObject });
}

export type { SiteRequest };

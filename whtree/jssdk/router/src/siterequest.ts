/* TODO establish the proper/stable approach with WHFSRequest. Eg open questions:
     - should we always return resolved objects (targetObject/targetFolder/...) or id ?
     - should we wrap Request objects during routing or should we just immediately create the proper object ?
*/

import { openFolder, openSite, Site, WHFSFolder, WHFSObject } from "@webhare/whfs";
import { SiteResponse, SiteResponseSettings } from "./sitereponse";
import { WebRequest } from "./request";
import { buildPluginData, getApplyTesterForObject } from "@webhare/whfs/src/applytester";
import * as resourcetools from "@mod-system/js/internal/resourcetools";
import { wrapHSWebdesign } from "./hswebdesigndriver";

export type WebDesignFunction<T extends object> = (request: SiteRequest, settings: SiteResponseSettings) => Promise<SiteResponse<T>>;
export type ComposerHookFunction<PluginDataType = Record<string, unknown>, T extends object = object> = (plugindata: PluginDataType, composer: SiteResponse<T>) => Promise<void> | void;

class SiteRequest {
  readonly webRequest: WebRequest;
  readonly targetObject: WHFSObject; //we could've gone for "WHFSFile | null" but then you'd *always* have to check for null. pointing to WHFSObject allows you to only check the real type sometimes
  readonly targetFolder: WHFSFolder;
  readonly targetSite: Site;
  readonly contentObject: WHFSObject;
  readonly navObject: WHFSObject;

  constructor(webRequest: WebRequest, targetSite: Site, targetFolder: WHFSFolder, targetObject: WHFSObject, { contentObject, navObject }: { contentObject?: WHFSObject; navObject?: WHFSObject } = {}) {
    this.webRequest = webRequest;
    this.targetSite = targetSite;
    this.targetFolder = targetFolder;
    this.targetObject = targetObject;
    this.contentObject = contentObject ?? targetObject;
    this.navObject = navObject ?? targetObject;
  }

  async createComposer<T extends object = object>(options?: { __captureJSDesign?: boolean }): Promise<SiteResponse<T>> { //async because we may delay loading the actual webdesign code until this point
    const applytester = await getApplyTesterForObject(this.targetObject);
    const publicationsettings = await applytester.getWebDesignInfo();
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
    settings.lang = await applytester.getSiteLanguage();

    const factory = await resourcetools.loadJSFunction<WebDesignFunction<T>>(publicationsettings.siteResponseFactory);
    const composer = await factory(this, settings);

    for (const plugin of publicationsettings.plugins) //apply plugins
      if (plugin.composerhook) {
        const plugindata = buildPluginData(plugin.datas);
        (await resourcetools.loadJSFunction<ComposerHookFunction>(plugin.composerhook))(plugindata, composer);
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

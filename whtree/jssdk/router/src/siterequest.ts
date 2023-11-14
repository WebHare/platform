/* TODO establish the proper/stable approach with WHFSRequest. Eg open questions:
     - should we always return resolved objects (targetObject/targetFolder/...) or id ?
     - should we wrap Request objects during routing or should we just immediately create the proper object ?
*/

import { openFolder, openSite, Site, WHFSFile, WHFSFolder, WHFSObject } from "@webhare/whfs";
import { SiteResponse, SiteResponseSettings } from "./sitereponse";
import { WebRequest } from "./request";
import { getApplyTesterForObject } from "@webhare/whfs/src/applytester";
import * as resourcetools from "@mod-system/js/internal/resourcetools";
import { wrapHSWebdesign } from "./hswebdesigndriver";
import { CSPPluginDataRow } from "@webhare/whfs/src/siteprofiles";

export type WebDesignFunction<T extends object> = (request: SiteRequest, settings: SiteResponseSettings) => Promise<SiteResponse<T>>;
export type ComposerHookFunction<PluginDataType = object, T extends object = object> = (plugindata: PluginDataType, composer: SiteResponse<T>) => Promise<void> | void;

function buildPluginData(datas: CSPPluginDataRow[]) {
  /* this is the more-or-less equivalent of CombinePartialNodes. it receives one or more records of the format

    account: 'GTM-TN7QQM',
    integration: 'script',
    launch: 'pagerender',
    __attributes: [ 'ACCOUNT' ],
    __location: 'mod::webhare_testsuite/webdesigns/basetestjs/basetestjs.siteprl.xml:63'

    It should take the first record as returnvalue (without the __ props) and for the following records, merge only the cells mentioned in __attributes.
    Note that __attributes is uppercase but the cells themselvs are lowercase
   */
  const data = { ...datas[0] } as Omit<CSPPluginDataRow, '__attributes' | '__location'> & { __attributes?: string[]; __location?: string };
  delete data.__attributes;
  delete data.__location;
  for (const row of datas.slice(1))
    for (const key of row.__attributes.map(attr => attr.toLowerCase()))
      data[key] = row[key];

  return data;
}

class SiteRequest {
  readonly webRequest: WebRequest;
  readonly targetObject: WHFSObject; //we could've gone for "WHFSFile | null" but then you'd *always* have to check for null. pointing to WHFSObject allows you to only check the real type sometimes
  readonly targetFolder: WHFSFolder;
  readonly targetSite: Site;
  readonly contentObject: WHFSObject;
  readonly navObject: WHFSObject;

  constructor(webRequest: WebRequest, targetSite: Site, targetFolder: WHFSFolder, targetObject: WHFSFile, { contentObject, navObject }: { contentObject?: WHFSObject; navObject?: WHFSObject } = {}) {
    this.webRequest = webRequest;
    this.targetSite = targetSite;
    this.targetFolder = targetFolder;
    this.targetObject = targetObject;
    this.contentObject = contentObject ?? targetObject;
    this.navObject = navObject ?? targetObject;
  }

  async createComposer<T extends object = object>(): Promise<SiteResponse<T>> { //async because we may delay loading the actual webdesign code until this point
    const applytester = await getApplyTesterForObject(this.targetObject);
    const publicationsettings = await applytester.getWebDesignInfo();
    if (!publicationsettings.siteresponsefactory)
      return wrapHSWebdesign<T>(this);

    const factory = await resourcetools.loadJSFunction<WebDesignFunction<T>>(publicationsettings.siteresponsefactory);
    //FIXME - we need to fill in some more data based on the site profile
    const settings = new SiteResponseSettings;
    settings.assetpack = publicationsettings.assetpack;
    settings.witty = publicationsettings.witty;
    settings.supportedlanguages = publicationsettings.supportedlanguages;

    const composer = await factory(this, settings);

    for (const plugin of publicationsettings.plugins) //apply plugins
      if (plugin.composerhook) {
        const plugindata = buildPluginData(plugin.datas);
        (await resourcetools.loadJSFunction<ComposerHookFunction>(plugin.composerhook))(plugindata, composer);
      }

    return composer;
  }
}

export async function buildSiteRequest(webRequest: WebRequest, targetObject: WHFSFile, { contentObject, navObject }: { contentObject?: WHFSObject; navObject?: WHFSObject } = {}): Promise<SiteRequest> {
  if (!targetObject.parentSite)
    throw new Error(`Target '${targetObject.whfsPath}' (#${targetObject.id}) is not in a site`);

  const targetSite = await openSite(targetObject.parentSite);
  const targetFolder = await openFolder(targetObject.parent!); //parent must exist if we're in a site.
  return new SiteRequest(webRequest, targetSite, targetFolder, targetObject, { contentObject, navObject });
}

export type { SiteRequest };

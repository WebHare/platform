/* TODO establish the proper/stable approach with WHFSRequest. Eg open questions:
     - should we always return resolved objects (targetobject/targetfolder/...) or id ?
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
  readonly webrequest: WebRequest;
  readonly targetobject: WHFSObject; //we could've gone for "WHFSFile | null" but then you'd *always* have to check for null. pointing to WHFSObject allows you to only check the real type sometimes
  readonly targetfolder: WHFSFolder;
  readonly targetsite: Site;
  readonly contentobject: WHFSObject;
  readonly navobject: WHFSObject;

  constructor(webrequest: WebRequest, targetsite: Site, targetfolder: WHFSFolder, targetobject: WHFSFile, { contentobject, navobject }: { contentobject?: WHFSObject; navobject?: WHFSObject } = {}) {
    this.webrequest = webrequest;
    this.targetsite = targetsite;
    this.targetfolder = targetfolder;
    this.targetobject = targetobject;
    this.contentobject = contentobject ?? targetobject;
    this.navobject = navobject ?? targetobject;
  }

  async createComposer<T extends object = object>(): Promise<SiteResponse<T>> { //async because we may delay loading the actual webdesign code until this point
    const applytester = await getApplyTesterForObject(this.targetobject);
    const publicationsettings = await applytester.getWebDesignInfo();
    if (!publicationsettings.siteresponsefactory)
      return wrapHSWebdesign<T>(this);

    const factory = await resourcetools.loadJSFunction(publicationsettings.siteresponsefactory) as WebDesignFunction<T>;
    //FIXME - we need to fill in some more data based on the site profile
    const settings = new SiteResponseSettings;
    settings.assetpack = publicationsettings.assetpack;
    settings.witty = publicationsettings.witty;
    settings.supportedlanguages = publicationsettings.supportedlanguages;

    const composer = await factory(this, settings);

    for (const plugin of publicationsettings.plugins) //apply plugins
      if (plugin.composerhook) {
        const plugindata = buildPluginData(plugin.datas);
        (await resourcetools.loadJSFunction(plugin.composerhook) as ComposerHookFunction)(plugindata, composer);
      }

    return composer;
  }
}

export async function buildSiteRequest(webrequest: WebRequest, targetobject: WHFSFile, { contentobject, navobject }: { contentobject?: WHFSObject; navobject?: WHFSObject } = {}): Promise<SiteRequest> {
  if (!targetobject.parentSite)
    throw new Error(`Target '${targetobject.whfsPath}' (#${targetobject.id}) is not in a site`);

  const targetsite = await openSite(targetobject.parentSite);
  const targetfolder = await openFolder(targetobject.parent!); //parent must exist if we're in a site.
  return new SiteRequest(webrequest, targetsite, targetfolder, targetobject, { contentobject, navobject });
}

export type { SiteRequest };

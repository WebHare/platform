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

export type WebDesignFunction<T extends object> = (request: SiteRequest, settings: SiteResponseSettings) => Promise<SiteResponse<T>>;

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
    const publicationsettings = await (await getApplyTesterForObject(this.targetobject)).getWebDesignInfo();
    if (!publicationsettings.siteresponsefactory)
      return wrapHSWebdesign<T>(this);

    const factory = await resourcetools.loadJSFunction(publicationsettings.siteresponsefactory) as WebDesignFunction<T>;
    const settings: SiteResponseSettings = { //TODO is it useful to transfer these from siteprl to webdesign? why can't the user's WebDesignFunction manage these?
      assetpack: publicationsettings.assetpack,
      witty: publicationsettings.witty
    };
    return await factory(this, settings);
  }
}

export async function buildSiteRequest(webrequest: WebRequest, targetobject: WHFSFile): Promise<SiteRequest> {
  if (!targetobject.parentsite)
    throw new Error(`Target '${targetobject.whfspath}' (#${targetobject.id}) is not in a site`);

  const targetsite = await openSite(targetobject.parentsite);
  const targetfolder = await openFolder(targetobject.parent!); //parent must exist if we're in a site.
  return new SiteRequest(webrequest, targetsite, targetfolder, targetobject);
}

export type { SiteRequest };

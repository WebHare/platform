/* TODO establish the proper/stable approach with WHFSRequest. Eg open questions:
     - should we always return resolved objects (targetobject/targetfolder/...) or id ?
     - should we wrap Request objects during routing or should we just immediately create the proper object ?
*/

import { WHFSFile } from "@webhare/whfs";
import { SiteResponse, SiteResponseSettings } from "./sitereponse";
import { WebRequest } from "./request";
import { WebResponse } from "./response";
import { getApplyTesterForObject } from "@webhare/whfs/src/applytester";
import * as resourcetools from "@mod-system/js/internal/resourcetools";
import { wrapHSWebdesign } from "./hswebdesigndriver";

export type WebDesignFunction<T extends object> = (request: SiteRequest, webresponse: WebResponse, settings: SiteResponseSettings) => Promise<SiteResponse<T>>;

export class SiteRequest {
  readonly webrequest: WebRequest;
  readonly targetobject: WHFSFile;

  constructor(webrequest: WebRequest, targetobject: WHFSFile) {
    this.webrequest = webrequest;
    this.targetobject = targetobject;
  }

  async createComposer<T extends object = object>(response: WebResponse): Promise<SiteResponse<T>> { //async because we may delay loading the actual webdesign code until this point
    const publicationsettings = await (await getApplyTesterForObject(this.targetobject)).getWebDesignInfo();
    if (!publicationsettings.siteresponsefactory)
      return wrapHSWebdesign<T>(this, response);

    const factory = await resourcetools.loadJSFunction(publicationsettings.siteresponsefactory) as WebDesignFunction<T>;
    const settings: SiteResponseSettings = { //TODO is it useful to transfer these from siteprl to webdesign? why can't the user's WebDesignFunction manage these?
      assetpack: publicationsettings.assetpack,
      witty: publicationsettings.witty
    };
    return await factory(this, response, settings);
  }
}

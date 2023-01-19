/* TODO establish the proper/stable approach with WHFSRequest. Eg open questions:
     - should we always return resolved objects (targetobject/targetfolder/...) or id ?
     - should we wrap Request objects during routing or should we just immediately create the proper object ?
*/

import { WHFSFile } from "@webhare/whfs";
import { SiteResponse } from "./sitereponse";
import { WebRequest } from "./request";
import { WebResponse } from "./response";
import { getApplyTesterForObject } from "@webhare/whfs/src/applytester";
import * as resourcetools from "@mod-system/js/internal/resourcetools";
import { wrapHSWebdesign } from "./hswebdesigndriver";

export type WebDesignFunction<T extends object> = (request: SiteRequest, webresponse: WebResponse) => Promise<SiteResponse<T>>;

export class SiteRequest implements WebRequest {
  readonly request: WebRequest;
  readonly targetobject: WHFSFile;

  get method() { return this.request.method; }
  get url() { return this.request.url; }

  constructor(request: WebRequest, targetobject: WHFSFile) {
    this.request = request;
    this.targetobject = targetobject;
  }

  async createComposer<T extends object = object>(response: WebResponse): Promise<SiteResponse<T>> { //async because we may delay loading the actual webdesign code until this point
    const publicationsettings = await (await getApplyTesterForObject(this.targetobject)).getWebDesignInfo();
    const webdesignfunctionname = publicationsettings.objectname; //FIXME its not really an objectname. set up a separate property ?

    if (webdesignfunctionname.split('#')[0].endsWith(".whlib"))
      return wrapHSWebdesign<T>(this, response);

    const webdesignfunction = await resourcetools.loadJSFunction(webdesignfunctionname) as WebDesignFunction<T>;
    return await webdesignfunction(this, response);
  }
}

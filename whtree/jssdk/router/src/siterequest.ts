/* TODO establish the proper/stable approach with WHFSRequest. Eg open questions:
     - should we always return resolved objects (targetobject/targetfolder/...) or id ?
     - should we wrap Request objects during routing or should we just immediately create the proper object ?
*/

import { WHFSFile } from "@webhare/whfs";
import { SiteResponse } from "./sitereponse";
import { WebRequest } from "./request";
import { WebResponse } from "./response";

export class SiteRequest implements WebRequest {
  readonly request: WebRequest;
  readonly targetobject: WHFSFile;

  get method() { return this.request.method; }
  get url() { return this.request.url; }

  constructor(request: WebRequest, targetobject: WHFSFile) {
    this.request = request;
    this.targetobject = targetobject;
  }

  async createComposer(response: WebResponse): Promise<SiteResponse> { //async because we may delay loading the actual webdesign code until this point
    return new SiteResponse(this, response);
  }
}

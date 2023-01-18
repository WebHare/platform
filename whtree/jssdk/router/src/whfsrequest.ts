/* TODO establish the proper/stable approach with WHFSRequest. Eg open questions:
     - should we always return resolved objects (targetobject/targetfolder/...) or id ?
     - should we wrap Request objects during routing or should we just immediately create the proper object ?
*/

import { WHFSFile } from "@webhare/whfs";
import { WebRequest } from "./request";

export class WHFSRequest implements WebRequest {
  readonly request: WebRequest;
  readonly targetobject: WHFSFile;

  get method() { return this.request.method; }
  get url() { return this.request.url; }

  constructor(request: WebRequest, targetobject: WHFSFile) {
    this.request = request;
    this.targetobject = targetobject;
  }
}

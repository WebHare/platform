import { WHFSFile } from "@webhare/whfs";

/* TODO establish the proper/stable approach with WHFSRequest. Eg open questions:
     - should we always return resolved objects (targetobject/targetfolder/...) or id ?
     - should we wrap Request objects during routing or should we just immediately create the proper object ?
*/


export class WebRequest {
  readonly method: string;
  readonly url: string;

  constructor(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
}

//TODO we should probably be inspired by Expres
export class WebResponse {
  private body: string;

  constructor() {
    this.body = '';
  }

  /** Render the contents of the specified witty component (path#component) with te specified data
      Using path:component is a syntax error and will throw if detected
      Resolves when completed. If you're not waiting, don't modify dataobject and any contained objects until the Witty has completed running! */
  //  async addWitty(wittycomponent: string, dataobject?: unknown);

  /** Finish any async additions */
  //  async flush()

  /** Append the specified text */
  async addText(text: string) {
    this.body += text;
  }

  /** Retrieve the final page */
  async getFinalPage() {
    return {
      body: `<html><body>` + this.body + `</body</html>`,
      headers: { "content-type": "text/html; charset=utf-8" }
    };
  }
}

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

export type WebHareWHFSRouter = (request: WHFSRequest, response: WebResponse) => Promise<void>;
export type WebHareRouter = (request: WebRequest, response: WebResponse) => Promise<void>;

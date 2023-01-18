import { WebResponse } from "./response";
import { SiteRequest } from "./siterequest";

/** SiteResponse implements HTML pages rendered using site configuration from WHFS and site profiles */
export class SiteResponse<T extends object> {
  siterequest: SiteRequest;
  webresponse: WebResponse;
  private contents = "";

  /** The pageconfig. Not protected because we assume that if you know it's type T, its on you if you access it */
  pageconfig: T;

  constructor(pageconfig: T, siterequest: SiteRequest, webresponse: WebResponse) {
    this.siterequest = siterequest;
    this.webresponse = webresponse;
    this.pageconfig = pageconfig;
  }

  /** Render the contents of the specified witty component (path#component) with the specified data
    Using path:component is a syntax error and will throw if detected
    Resolves when completed. If you're not waiting, don't modify dataobject and any contained objects until the Witty has completed running! */
  //  async addWitty(wittycomponent: string, dataobject?: unknown);

  /** Finish any async additions */
  //  async flush()

  /** Append the specified text */
  appendHTML(text: string) {
    this.contents += text;
  }

  flush() {
    //TODO: format the final body using htmlhead/htmlbody and our own headers. See WebDesignBase::RunPageWitty for all the classes etc we need
    const body = `<!DOCTYPE html>`
      + `<html>` //lang etc
      + `<head></head>`
      + `<body>${this.contents}</body>`
      + `</html>`;

    this.webresponse.setBody(body);
  }
}

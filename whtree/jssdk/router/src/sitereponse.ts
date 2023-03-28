import { WittyTemplate } from "@webhare/witty";
import { readFile } from "node:fs";
import { createWebResponse, WebResponse } from "./response";
import type { SiteRequest } from "./siterequest";
import util from 'node:util';
import * as services from "@webhare/services";

export interface SiteResponseSettings {
  assetpack: string;
  witty: string;
}

/** SiteResponse implements HTML pages rendered using site configuration from WHFS and site profiles */
export class SiteResponse<T extends object> {
  siterequest: SiteRequest;
  settings: SiteResponseSettings;
  protected contents = "";

  /** The pageconfig. Not protected because we assume that if you know it's type T, its on you if you access it */
  pageconfig: T;

  constructor(pageconfig: T, siterequest: SiteRequest, settings: SiteResponseSettings) {
    this.siterequest = siterequest;
    this.pageconfig = pageconfig;
    this.settings = settings;
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

  async finish(): Promise<WebResponse> {
    const mywittytext = (await util.promisify(readFile)(services.toFSPath(this.settings.witty))).toString();
    const mywitty = new WittyTemplate(mywittytext); //TODO check/handle errors? or Will It Throw?
    const body = await mywitty.run({
      ...this.pageconfig,
      contents: this.contents
    });

    if (body === null)
      throw new Error("Witty returned 'null' (it failed?)"); //FIXME shouldn't witty just throw? I presume callbacks inside witty will be able to throw anyway

    return createWebResponse(`<html><head></head><body>` + body + `</body></html>`);
  }
}
